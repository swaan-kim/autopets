// Codex reports the parent's session_id in child hooks. Presence of child
// metadata, even malformed metadata, must never fall through to parent state.
export function isChildHook(input) {
  return input !== null && typeof input === 'object' && (
    input.agent_id != null || input.agent_type != null
    || ['SubagentStart', 'SubagentStop'].includes(input.hook_event_name));
}
