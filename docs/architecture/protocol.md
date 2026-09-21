# AutoPets local protocol v1

Internal implementation contract. Rust owns state and SQLite; the UI uses Tauri commands. The current product observes actual Codex events and shows attention. It does not approve requests, stop tasks, change models, or infer task token use.

## Transport and data

The app writes `connection.json` to `%LOCALAPPDATA%/local.autopets.desktop`, or the explicit `AUTOPETS_DATA_DIR`. It contains `{version:1,baseUrl:"http://127.0.0.1:<port>",token:"<secret>"}`. The Node adapter takes the absolute path with `--connection`; the skill client also discovers the configured directory. Do not print or share the token.

The server binds a dynamic IPv4 loopback port. Every route requires `Authorization: Bearer <token>`; any `Origin` header is rejected. JSON bodies are limited to 256 KiB. Authentication failure is 401, browser origin is 403, shutdown is 503. Identifiers must be nonempty, at most 512 bytes, and contain no control characters. All times are Unix epoch milliseconds.

SQLite stores session/event metadata, settings, actual plan text, attention records, slot bindings, and configuration request fingerprints. It does not store prompts, tool output, shell text, or token counters. The existing session table gains a defaulted supervision JSON column; old rows retain their data and receive the v1 defaults. Restart restores settings/attention but marks connections unknown until another observation. Old EXE-adjacent `.local` data is not copied or deleted; opt into it with `AUTOPETS_DATA_DIR`.

## Actual events

`POST /v1/events` returns `{ok:true}`; malformed events return 400.

```ts
type Activity = 'idle' | 'research' | 'writing' | 'tool' | 'working';
type PlanStep = {step: string; status: 'pending' | 'in_progress' | 'completed'};
type Event = {
  eventId: string; sessionId: string; turnId?: string; cwd: string;
  kind: 'session_started' | 'turn_started' | 'tool_started' | 'tool_finished'
      | 'turn_finished' | 'interrupted' | 'session_ended'
      | 'plan_updated' | 'permission_requested';
  timestamp: number; toolName?: string; toolCallId?: string;
  activity?: Activity; plan?: {steps: PlanStep[]}; toolError?: boolean;
};
```

The adapter maps SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, Interrupt, SessionEnd, and PermissionRequest. It requires a turn ID except for session lifecycle events. Unsupported/missing hook shapes fall through. Every invocation writes `{}` to hook stdout, including permission attention; it never emits an approval decision. No production endpoint inserts demonstration tasks.

Activity uses exact tool-name rules only. Plan data is accepted only on an `update_plan` result (`tool_finished` or `plan_updated`). The adapter currently requires the supported success text `Plan updated` before forwarding the input plan. Plans contain at most 50 nonempty steps of at most 500 characters, and at most one `in_progress` step. A failed result cannot publish a plan. No arbitrary tool output is classified or saved.

Only a structured `tool_response.isError === true` maps to `toolError:true` on `tool_finished`. It creates `tool-error` attention without setting the entire session to failed. The next observed tool start closes that attention. Text containing “error” is not error evidence. The `failed` session enum remains for compatibility; the adapter does not infer whole-task failure.

Event IDs deduplicate atomically. Older timestamps and events for a different active working turn cannot overwrite the current plan/state. Persistent terminal-event history prevents a retired turn ID from reviving. After a known terminal turn, a later actual tool/plan/permission event for a different, never-terminal turn can recover a missing start hook and reset the observed timer/plan. It cannot replace an unfinished active turn. SessionStart alone is observation, not a new turn. Missing/reordered hooks can still leave state incomplete. Timestamps are adapter observations, not a complete execution log. Subagent events never imply parent completion.

## Skill configuration and slots

`GET /v1/task-context?sessionId=<current task>&cwd=<actual cwd>` returns `{sessionId,turnId,cwd}` only for an observed, unfinished active turn with matching normalized project path. Unknown/inactive/mismatched context returns 404. Windows path comparison normalizes slash direction, case, and trailing slash. The skill takes the current task ID from `CODEX_THREAD_ID` and validates the returned identity; it cannot select another task through command-line IDs.

```ts
// POST /v1/task-config
type TaskConfiguration = {
  requestId: string; sessionId: string; turnId: string; cwd: string;
  completionCriterion: string;
  interventionMode: 'when-needed' | 'milestones';
  elapsedAlertMinutes: number | null;
};
// Success: {ok:true, sessionId:string, slot:0|1|2}
```

Completion criteria require 1–2,000 characters. Time limits require integer minutes from 1–1,440 or `null` for off; the default is 10. The exact task/turn/project is rechecked. Keep an existing binding; otherwise use the first empty slot. Never replace another task. All three occupied returns 409 `{error:"slots-full"}` with no configuration/assignment change. Other context/content conflicts also return 409.

A stable request ID and persisted SHA-256 payload fingerprint prevent an uncertain retry from applying altered content. Configuration, request marker, and slot binding commit in one savepoint with matching memory rollback. An identical retry keeps existing settings and ensures a valid binding. Manual assignment remains available; there are three slots and a session can occupy only one.

## Snapshot and Tauri commands

`autopets://snapshot` broadcasts the snapshot. `get_snapshot()` provides polling recovery.

```ts
type Attention = {
  id: string; kind: 'permission' | 'tool-error' | 'elapsed' | 'milestone';
  summary: string; createdAt: number; snoozedUntil: number | null;
};
type Session = {
  id: string; label: string; cwd: string;
  state: 'idle' | 'working' | 'waiting' | 'done' | 'failed';
  unread: boolean; lastSeen: number; lastTool: string | null;
  connection: 'observed' | 'unknown' | 'ended';
  completionCriterion: string;
  interventionMode: 'when-needed' | 'milestones';
  activity: Activity; planSteps: PlanStep[]; planUpdatedAt: number | null;
  turnStartedAt: number | null; turnEndedAt: number | null;
  elapsedAlertMinutes: number | null; attention: Attention | null;
};
type Snapshot = {
  sessions: Session[]; slots: {index: number; sessionId: string | null}[];
  approvals: LegacyApproval[]; approvalEnabled: false;
  connectionPath: string; now: number;
  capabilities: {tokenUsage: 'unavailable'; taskReturn: 'manual'};
};
```

New session fields are flattened JSON, not a nested `supervision` object. Private attention history and fingerprints are not exposed. `lastSeen` means event receipt; an observed connection is not a live agent heartbeat. Bridge failure is not task failure. Stop means a response arrived, not that the completion criterion was independently verified.

Commands use camelCase JavaScript arguments:

- `configure_session({sessionId,completionCriterion,interventionMode,elapsedAlertMinutes})`
- `acknowledge_attention({sessionId,attentionId})`
- `snooze_attention({sessionId,attentionId,minutes})`; 1–240 minutes, UI offers 10.
- `assign_session({slot,sessionId})`, `unassign_session({slot})`, `rename_session({sessionId,label})`
- `acknowledge({sessionId})` clears the separate unread response indicator.
- `show_manager()`, `set_pets_visible({visible})`, `open_pet({slot})`, `set_pet_expanded({expanded})`, `quit_app()`

Time is measured from the first observed turn start, or the first actual tool/plan/permission event when no active turn was previously observed or the terminal-turn recovery above applies. It is not billed time or exact task runtime. A connected, assigned, unfinished turn receives its elapsed alert once; its emitted-turn marker persists. Changing the limit uses that same observed start, without resetting the clock. Turning the alert off closes it. After one has fired, re-enabling/changing the limit does not create another for the same turn. A new turn resets the timer/marker. Restarted sessions do not create new alerts until observation resumes.

Acknowledging only dismisses attention. Snoozing keeps the same attention and makes it due later. Neither sends a message, approves a request, stops work, or changes task state. Unsnoozed/due attentions appear before snoozed ones; priority within that group is permission, tool error, elapsed, then milestone. Permission attention closes only on the matching tool-call completion or turn end; unrelated parallel tools do not dismiss it. Without a correlation ID it remains until acknowledged or the turn ends. Milestone mode announces actual newly completed plan steps; when-needed does not. The next turn closes old-turn alerts.

With no assignments, the first standalone pet is visible before connection; no fake session is created. With assignments, only their pets are shown. Task return remains manual because an external exact-task deep-link contract has not been verified. The UI shows the exact task ID/project and finding instructions.

## Dormant approval history

The previous experiment's HTTP routes remain for compatibility: `POST /v1/approvals`, `GET /v1/approvals/{requestId}/wait`, `POST /v1/approvals/{requestId}/returned`, and `/abandon`. Production approval enabling is disabled, the UI exposes no enable/allow/deny commands, and the v1 adapter does not call them. Registration passes through without waiting.

`LegacyApproval` retains `{requestId,sessionId,turnId,toolName,description,details,createdAt,expiresAt,status,delivery}`. Historical status is pending/approved/denied/forwarded/cancelled; delivery is waiting/received/invalidated. Legacy request details are memory-only and cleared on resolution. Persisted decisions are never replayed: restart invalidates unreturned deliveries. Dormant checks retain 30-minute TTL, 45-second lease, 15-second bounded polling, immutable terminal decisions, and exact session/turn/request binding. These are not current product controls or evidence of a verified Desktop approval round trip.
