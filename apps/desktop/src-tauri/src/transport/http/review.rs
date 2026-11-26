use super::*;
use crate::domain::{pet_link::Target, review::{NewCard, ReviewResult}};

/// 복습 도우미 cards, called by the `pet.mjs review-*` scripts in the chat linked to that pet.
#[derive(serde::Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(super) enum ReviewRequest {
    /// A new "문제 내기" (`batch.name`: the cards become one batch), or questions added during a
    /// batch review (`batch.id`: they join that batch). Exactly one of the two.
    Save { target: Target, batch: SaveBatch, cards: Vec<NewCard> },
    /// Today's cards, or that batch's part of them; with `all`, every card of that batch.
    Due { target: Target, #[serde(default)] batch: Option<String>, #[serde(default)] all: bool },
    Result { target: Target, results: Vec<ReviewResult>, #[serde(default)] batch: Option<String>, #[serde(default)] all: bool },
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SaveBatch { #[serde(default)] name: Option<String>, #[serde(default)] id: Option<String> }

impl SaveBatch {
    fn to(self) -> Result<crate::domain::review::SaveTo, String> {
        match (self.name, self.id) {
            (Some(name), None) => Ok(crate::domain::review::SaveTo::New(name)),
            (None, Some(id)) => Ok(crate::domain::review::SaveTo::Batch(id)),
            _ => Err("invalid-review-batch".into()),
        }
    }
}

pub(super) async fn dispatch(State(state): State<BridgeState>, Json(input): Json<ReviewRequest>) -> BridgeResult<serde_json::Value> {
    let mut store = state.store.lock().map_err(state_error)?;
    let now = crate::domain::activity::now_ms();
    let (result, changed) = match input {
        ReviewRequest::Save { target, batch, cards } => (batch.to().and_then(|to| store.save_review_cards(&target, to, cards, now)), true),
        ReviewRequest::Due { target, batch, all } => (store.review_due(&target, batch.as_deref(), all, now), false),
        ReviewRequest::Result { target, results, batch, all } => (store.record_review_results(&target, results, batch.as_deref(), all, now), true),
    };
    let result = result.map_err(|reason| error(match reason.as_str() {
        "invalid-review-card" | "invalid-review-batch" | "invalid-pet-target" => StatusCode::BAD_REQUEST,
        "pet-not-connected" | "review-batch-not-found" => StatusCode::NOT_FOUND,
        _ => StatusCode::CONFLICT,
    }, reason))?;
    if changed {
        let snapshot = store.snapshot();
        drop(store);
        (state.on_change)(snapshot);
    }
    Ok(Json(result))
}
