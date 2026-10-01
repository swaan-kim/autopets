use super::activity::{EventInput, EventKind};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolState { Running, Completed, Failed, Unknown }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub state: ToolState,
    pub observed_at: u64,
    #[serde(default)]
    pub conflicting: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    pub version: u8,
    pub turn_id: String,
    pub calls: Vec<ToolCall>,
    pub truncated: bool,
}

impl ToolActivity {
    pub fn mark_unconfirmed(&mut self) {
        for call in &mut self.calls {
            if call.state == ToolState::Running { call.state = ToolState::Unknown; }
        }
    }

    pub fn observe(current: &mut Option<Self>, event: &EventInput, now: u64) {
        let Some(turn) = event.turn_id.as_deref().filter(|s| !s.is_empty()) else { return; };
        if matches!(event.kind, EventKind::TurnStarted) {
            if current.as_ref().is_some_and(|old| old.turn_id != turn) { *current = None; }
            return;
        }
        if !matches!(event.kind, EventKind::ToolStarted | EventKind::ToolFinished) { return; }
        let (Some(id), Some(name)) = (&event.tool_call_id, &event.tool_name) else { return; };
        if id.is_empty() || id.len() > 512 || id.chars().any(char::is_control)
            || name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) { return; }
        if current.as_ref().is_some_and(|old| old.version != 1 || old.turn_id != turn) { *current = None; }
        let activity = current.get_or_insert_with(|| Self { version: 1, turn_id: turn.into(), calls: vec![], truncated: false });
        let state = if matches!(event.kind, EventKind::ToolStarted) { ToolState::Running }
            else if event.tool_error == Some(true) { ToolState::Failed } else { ToolState::Completed };
        let at = event.timestamp.min(now);
        if let Some(call) = activity.calls.iter_mut().find(|call| call.id == *id) {
            // A terminal result wins over repeated starts, including equal clocks.
            // Reusing one call id for another tool is conflicting evidence.
            if call.conflicting { return; }
            if call.name != *name || (matches!(call.state, ToolState::Completed | ToolState::Failed)
                && matches!(state, ToolState::Completed | ToolState::Failed) && call.state != state) {
                call.state = ToolState::Unknown;
                call.conflicting = true;
                call.observed_at = call.observed_at.max(at);
                return;
            }
            if at < call.observed_at || matches!(call.state, ToolState::Completed | ToolState::Failed) { return; }
            call.state = state;
            call.observed_at = at;
        } else {
            if activity.calls.len() == 64 {
                activity.truncated = true;
                // Do not discard an active call to fabricate a complete inventory.
                let Some(index) = activity.calls.iter().position(|call| call.state != ToolState::Running) else { return; };
                activity.calls.remove(index);
            }
            activity.calls.push(ToolCall { id: id.clone(), name: name.clone(), state, observed_at: at, conflicting: false });
        }
    }
}
