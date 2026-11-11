use super::*;
use crate::domain::activity::EventKind;
use crate::domain::supervision::Activity;

// Claude Code surface: its plugin hooks send metadata only, through their own
// route and their own typed input, then join the shared activity model. Plans
// and prompt-time workflow steps are Codex-only and are not accepted here.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ClaudeCodeKind {
    SessionStarted,
    TurnStarted,
    ToolStarted,
    ToolFinished,
    PermissionRequested,
    TurnFinished,
    Interrupted,
    SessionEnded,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ClaudeCodeEvent {
    event_id: String,
    session_id: String,
    turn_id: Option<String>,
    kind: ClaudeCodeKind,
    cwd: String,
    tool_name: Option<String>,
    tool_call_id: Option<String>,
    timestamp: u64,
    activity: Option<Activity>,
    tool_error: Option<bool>,
}

impl From<ClaudeCodeEvent> for EventInput {
    fn from(event: ClaudeCodeEvent) -> Self {
        let kind = match event.kind {
            ClaudeCodeKind::SessionStarted => EventKind::SessionStarted,
            ClaudeCodeKind::TurnStarted => EventKind::TurnStarted,
            ClaudeCodeKind::ToolStarted => EventKind::ToolStarted,
            ClaudeCodeKind::ToolFinished => EventKind::ToolFinished,
            ClaudeCodeKind::PermissionRequested => EventKind::PermissionRequested,
            ClaudeCodeKind::TurnFinished => EventKind::TurnFinished,
            ClaudeCodeKind::Interrupted => EventKind::Interrupted,
            ClaudeCodeKind::SessionEnded => EventKind::SessionEnded,
        };
        EventInput {
            event_id: event.event_id,
            session_id: event.session_id,
            turn_id: event.turn_id,
            kind,
            cwd: event.cwd,
            tool_name: event.tool_name,
            tool_call_id: event.tool_call_id,
            timestamp: event.timestamp,
            activity: event.activity,
            plan: None,
            tool_error: event.tool_error,
        }
    }
}

pub(super) async fn events(
    State(state): State<BridgeState>,
    Json(input): Json<ClaudeCodeEvent>,
) -> BridgeResult<serde_json::Value> {
    let snapshot = {
        let mut store = state.store.lock().map_err(state_error)?;
        store
            .apply_event(input.into())
            .map_err(|e| error(StatusCode::BAD_REQUEST, e))?;
        store.snapshot()
    };
    (state.on_change)(snapshot);
    Ok(Json(serde_json::json!({"ok":true})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_code_events_are_metadata_only_and_never_carry_plans() {
        let body = serde_json::json!({
            "eventId": "e1", "sessionId": "s1", "turnId": "p1", "kind": "tool_finished",
            "cwd": "C:/합성/시험", "toolName": "Read", "toolCallId": "toolu_1",
            "timestamp": 10, "activity": "research", "toolError": true
        });
        let event: EventInput = serde_json::from_value::<ClaudeCodeEvent>(body.clone()).unwrap().into();
        assert!(matches!(event.kind, EventKind::ToolFinished));
        assert!(event.plan.is_none());
        assert_eq!(event.tool_error, Some(true));
        let mut with_plan = body.clone();
        with_plan["plan"] = serde_json::json!({ "steps": [] });
        assert!(serde_json::from_value::<ClaudeCodeEvent>(with_plan).is_err());
        let mut plan_kind = body.clone();
        plan_kind["kind"] = serde_json::json!("plan_updated");
        assert!(serde_json::from_value::<ClaudeCodeEvent>(plan_kind).is_err());
        let mut prompt = body;
        prompt["prompt"] = serde_json::json!("내용");
        assert!(serde_json::from_value::<ClaudeCodeEvent>(prompt).is_err());
    }
}
