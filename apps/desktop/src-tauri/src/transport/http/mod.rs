use crate::application::store::{
    EventInput, SharedStore, Snapshot, TaskConfiguration, TaskConfigured, TaskContext,
};
use axum::{
    extract::{DefaultBodyLimit, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
};

mod auth;
mod handlers;
use crate::legacy::http::{abandon, approvals, returned, wait};
use auth::*;
use handlers::*;

pub type SnapshotCallback = Arc<dyn Fn(Snapshot) + Send + Sync + 'static>;

#[derive(Clone)]
pub(crate) struct BridgeState {
    pub(crate) store: SharedStore,
    pub(crate) token: Arc<str>,
    pub(crate) on_change: SnapshotCallback,
    pub(crate) stopping: watch::Receiver<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionInfo {
    pub(crate) version: u8,
    pub(crate) base_url: String,
    pub(crate) token: String,
}

pub struct BridgeHandle {
    pub base_url: String,
    pub connection_path: PathBuf,
    pub(crate) shutdown: Option<oneshot::Sender<()>>,
    pub(crate) stop_signal: watch::Sender<bool>,
    pub(crate) store: SharedStore,
    pub(crate) token: String,
}

impl BridgeHandle {
    pub fn shutdown(&mut self) {
        if let Ok(mut store) = self.store.lock() {
            let _ = store.shutdown();
        }
        let _ = self.stop_signal.send(true);
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
        // A stale instance must never delete a newer instance's connection file.
        if let Ok(bytes) = std::fs::read(&self.connection_path) {
            if let Ok(info) = serde_json::from_slice::<ConnectionInfo>(&bytes) {
                if constant_time_equal(info.token.as_bytes(), self.token.as_bytes()) {
                    let _ = std::fs::remove_file(&self.connection_path);
                }
            }
        }
    }
}

impl Drop for BridgeHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub async fn start(
    store: SharedStore,
    on_change: SnapshotCallback,
) -> Result<BridgeHandle, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Local bridge could not bind: {e}"))?;
    let base_url = format!(
        "http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let connection_path = store
        .lock()
        .map_err(|_| "State lock unavailable")?
        .data_dir
        .join("connection.json");
    let (stop_signal, stopping) = watch::channel(false);
    let state = BridgeState {
        store: store.clone(),
        token: Arc::from(token.as_str()),
        on_change: on_change.clone(),
        stopping,
    };
    let app = Router::new()
        .route("/v1/events", post(events))
        .route("/v1/task-context", get(task_context))
        .route("/v1/task-config", post(task_config))
        .route("/v1/assistance", post(assistance))
        .route("/v1/assistance-status", get(assistance_status))
        .route("/v1/approvals", post(approvals))
        .route("/v1/approvals/{request_id}/wait", get(wait))
        .route("/v1/approvals/{request_id}/returned", post(returned))
        .route("/v1/approvals/{request_id}/abandon", post(abandon))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .with_state(state.clone());
    let info = ConnectionInfo {
        version: 1,
        base_url: base_url.clone(),
        token: token.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&info).map_err(|e| e.to_string())?;
    // Kept in the configured local runtime directory, never emitted to hook logs.
    std::fs::write(&connection_path, bytes)
        .map_err(|e| format!("Cannot write local bridge connection file: {e}"))?;
    {
        let mut locked = store.lock().map_err(|_| "State lock unavailable")?;
        locked.set_connection_path(&connection_path);
    }
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        let mut stopping = state.stopping.clone();
        loop {
            tokio::select! {
                _=interval.tick()=> {
                    let snapshot=match state.store.lock() {
                        Ok(mut store)=> match store.tick() { Ok(true)=>Some(store.snapshot()),_=>None },
                        Err(_)=>None,
                    };
                    if let Some(snapshot)=snapshot { (state.on_change)(snapshot); }
                },
                _=stopping.changed()=>break,
            }
        }
    });
    let snapshot = store
        .lock()
        .map_err(|_| "State lock unavailable")?
        .snapshot();
    on_change(snapshot);
    Ok(BridgeHandle {
        base_url,
        connection_path,
        shutdown: Some(shutdown_tx),
        stop_signal,
        store,
        token,
    })
}

pub(crate) type BridgeResult<T> = Result<Json<T>, (StatusCode, Json<serde_json::Value>)>;

pub(crate) fn error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error":message.into()})))
}
pub(crate) fn state_error(
    _: std::sync::PoisonError<std::sync::MutexGuard<'_, crate::application::store::Store>>,
) -> (StatusCode, Json<serde_json::Value>) {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Local state is unavailable",
    )
}

#[cfg(test)]
mod tests;
