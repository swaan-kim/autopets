use crate::core::{
    ApprovalInput, ApprovalStatus, ApprovalWait, EventInput, SharedStore, Snapshot,
    TaskConfiguration, TaskConfigured, TaskContext,
};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
    time::Instant,
};

pub type SnapshotCallback = Arc<dyn Fn(Snapshot) + Send + Sync + 'static>;

#[derive(Clone)]
struct BridgeState {
    store: SharedStore,
    token: Arc<str>,
    on_change: SnapshotCallback,
    stopping: watch::Receiver<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInfo {
    version: u8,
    base_url: String,
    token: String,
}

pub struct BridgeHandle {
    pub base_url: String,
    pub connection_path: PathBuf,
    shutdown: Option<oneshot::Sender<()>>,
    stop_signal: watch::Sender<bool>,
    store: SharedStore,
    token: String,
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

fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b)
        .fold(0u8, |different, (a, b)| different | (a ^ b))
        == 0
}

async fn authenticate(State(state): State<BridgeState>, request: Request, next: Next) -> Response {
    if request.headers().contains_key(header::ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let expected = format!("Bearer {}", state.token);
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .is_some_and(|value| constant_time_equal(value.as_bytes(), expected.as_bytes()));
    if !authorized {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if *state.stopping.borrow() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    next.run(request).await
}

type BridgeResult<T> = Result<Json<T>, (StatusCode, Json<serde_json::Value>)>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskContextQuery {
    session_id: String,
    cwd: String,
}

async fn task_context(
    State(state): State<BridgeState>,
    Query(query): Query<TaskContextQuery>,
) -> BridgeResult<TaskContext> {
    let context = state
        .store
        .lock()
        .map_err(state_error)?
        .task_context(&query.session_id, &query.cwd)
        .map_err(|e| error(StatusCode::NOT_FOUND, e))?;
    Ok(Json(context))
}

async fn task_config(
    State(state): State<BridgeState>,
    Json(input): Json<TaskConfiguration>,
) -> BridgeResult<TaskConfigured> {
    let (result, snapshot) = {
        let mut store = state.store.lock().map_err(state_error)?;
        let result = store
            .configure_task(input)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        (result, store.snapshot())
    };
    (state.on_change)(snapshot);
    Ok(Json(result))
}
fn error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error":message.into()})))
}
fn state_error(
    _: std::sync::PoisonError<std::sync::MutexGuard<'_, crate::core::Store>>,
) -> (StatusCode, Json<serde_json::Value>) {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Local state is unavailable",
    )
}

async fn events(
    State(state): State<BridgeState>,
    Json(input): Json<EventInput>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .apply_event(input)
            .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}

async fn approvals(
    State(state): State<BridgeState>,
    Json(input): Json<ApprovalInput>,
) -> BridgeResult<crate::core::Registration> {
    let (response, snapshot) = {
        let mut store = state.store.lock().map_err(state_error)?;
        let response = store
            .register_approval(input)
            .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
        (response, store.snapshot())
    };
    (state.on_change)(snapshot);
    Ok(Json(response))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    session_id: String,
    turn_id: String,
}

async fn wait(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Query(binding): Query<Binding>,
) -> BridgeResult<ApprovalWait> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut stopping = state.stopping.clone();
    // Refresh once per client poll, not from each server-side recheck. A disconnected
    // client therefore cannot keep its lease alive with one abandoned HTTP request.
    let initial = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .wait_status(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?
    };
    if initial.status != ApprovalStatus::Pending {
        return Ok(Json(initial));
    }
    loop {
        tokio::select! {
            _=tokio::time::sleep(Duration::from_millis(150))=>{},
            _=stopping.changed()=>return Ok(Json(ApprovalWait{status:ApprovalStatus::Forwarded})),
        }
        let result = {
            let mut store = state.store.lock().map_err(state_error)?;
            store
                .peek_status(&request_id, &binding.session_id, &binding.turn_id)
                .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?
        };
        if result.status != ApprovalStatus::Pending || Instant::now() >= deadline {
            return Ok(Json(result));
        }
    }
}

async fn returned(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Json(binding): Json<Binding>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .mark_returned(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|e| error(StatusCode::CONFLICT, e))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}

async fn abandon(
    State(state): State<BridgeState>,
    Path(request_id): Path<String>,
    Json(binding): Json<Binding>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .abandon(&request_id, &binding.session_id, &binding.turn_id)
            .map_err(|_| error(StatusCode::NOT_FOUND, "Unknown or inactive approval"))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    async fn http(base_url: &str, method: &str, path: &str, headers: &str, body: &str) -> u16 {
        let address = base_url.strip_prefix("http://").unwrap();
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        let message = format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}\r\n{body}", body.len());
        socket.write_all(message.as_bytes()).await.unwrap();
        let mut output = String::new();
        let mut reader = BufReader::new(socket);
        tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut output))
            .await
            .unwrap()
            .unwrap();
        output.split_whitespace().nth(1).unwrap().parse().unwrap()
    }

    #[test]
    fn authorization_token_comparison_is_exact() {
        assert!(constant_time_equal(b"Bearer a", b"Bearer a"));
        assert!(!constant_time_equal(b"Bearer a", b"Bearer b"));
        assert!(!constant_time_equal(b"Bearer a", b"Bearer a "));
    }

    #[tokio::test]
    async fn actual_http_bridge_rejects_unauthorized_origins_oversized_and_wrong_bindings() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(std::sync::Mutex::new(
            crate::core::Store::new(dir.path()).unwrap(),
        ));
        let mut bridge = start(store.clone(), Arc::new(|_| {})).await.unwrap();
        let connection: ConnectionInfo =
            serde_json::from_slice(&std::fs::read(&bridge.connection_path).unwrap()).unwrap();
        let authorization = format!("Authorization: Bearer {}\r\n", connection.token);
        let event = serde_json::json!({"eventId":"e1","sessionId":"s1","turnId":"t1","kind":"turn_started","cwd":"C:/test","timestamp":crate::core::now_ms()}).to_string();
        assert_eq!(
            http(&bridge.base_url, "POST", "/v1/events", "", &event).await,
            401
        );
        assert_eq!(
            http(
                &bridge.base_url,
                "POST",
                "/v1/events",
                &format!("{authorization}Origin: http://localhost\r\n"),
                &event
            )
            .await,
            403
        );
        assert_eq!(
            http(
                &bridge.base_url,
                "POST",
                "/v1/events",
                &authorization,
                &event
            )
            .await,
            200
        );
        assert_eq!(
            http(
                &bridge.base_url,
                "GET",
                "/v1/approvals/missing/wait?sessionId=s1&turnId=t1",
                &authorization,
                ""
            )
            .await,
            404
        );
        assert_eq!(
            http(
                &bridge.base_url,
                "POST",
                "/v1/events",
                &authorization,
                &"x".repeat(256 * 1024 + 1)
            )
            .await,
            413
        );
        assert_eq!(store.lock().unwrap().snapshot().sessions.len(), 1);
        assert_eq!(
            http(
                &bridge.base_url,
                "GET",
                "/v1/task-context?sessionId=s1&cwd=C%3A%2Ftest",
                &authorization,
                ""
            )
            .await,
            200
        );
        assert_eq!(
            http(
                &bridge.base_url,
                "GET",
                "/v1/task-context?sessionId=s1&cwd=C%3A%2Fother",
                &authorization,
                ""
            )
            .await,
            404
        );
        let configure=serde_json::json!({"requestId":"configure1","sessionId":"s1","turnId":"t1","cwd":"C:/test","completionCriterion":"A report file","interventionMode":"when-needed","elapsedAlertMinutes":10}).to_string();
        assert_eq!(
            http(
                &bridge.base_url,
                "POST",
                "/v1/task-config",
                &authorization,
                &configure
            )
            .await,
            200
        );
        assert_eq!(
            store.lock().unwrap().snapshot().slots[0]
                .session_id
                .as_deref(),
            Some("s1")
        );
        assert!(!store.lock().unwrap().snapshot().approval_enabled);
        bridge.shutdown();
        assert!(!bridge.connection_path.exists());
    }
}
