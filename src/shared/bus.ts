/**
 * The wire protocol between the main runtime and anything that listens.
 *
 * Three channels, named after the reference client's own vocabulary:
 *
 *   invoke — request/response, the shape a Tauri command or an API call has
 *            (`run_prompt`, `run_prompt`'s cancel, `session_init`, …)
 *   event  — one-way broadcast (`message_delta`, `tool_approval_request`,
 *            `task_dispatched`, …)
 *   verb   — a *local action* the renderer/main executes on this machine and
 *            reports back (`read_file`, …)
 *
 * The names are literal strings, not enum members, because they are logged and
 * persisted in `audit.jsonl`. Renaming one is a protocol break.
 */

export type BusChannel = "invoke" | "event" | "verb";

export interface BusFrame<T = unknown> {
  channel: BusChannel;
  /** Literal protocol name, e.g. `message_delta`. */
  name: string;
  /** Correlation id (invoke id, run id prefix, or verb request id). */
  id: string;
  at: number;
  runId?: string;
  agentId?: string;
  payload: T;
}

/** Requests the runtime answers. `run_prompt` is the reference summon invoke. */
export const INVOKE = {
  runPrompt: "run_prompt",
  cancelRun: "cancel_run",
  sessionInit: "session_init",
  toolDecision: "tool_decision",
  listModels: "list_models",
  agentCreate: "agent_create",
  agentDissolve: "agent_dissolve",
  getState: "get_state",
} as const;

/** Broadcasts. These names are persisted in the audit journal. */
export const EVENT = {
  companionCreated: "companion_created",
  companionUpdated: "companion_updated",
  companionDeleted: "companion_deleted",
  messageStart: "message_start",
  messageDelta: "message_delta",
  messageEnd: "message_end",
  toolApprovalRequest: "tool_approval_request",
  toolApprovalResolved: "tool_approval_resolved",
  toolExecuted: "tool_executed",
  taskStarted: "task_started",
  taskDispatched: "task_dispatched",
  taskProgress: "task_progress",
  taskStatusAck: "task_status_ack",
  taskCompleted: "task_completed",
  taskFailed: "task_failed",
  /** ours: no reference event; cancellation is a socket close there. */
  taskCancelled: "task_cancelled",
  botSpawned: "bot_spawned",
  botDissolved: "bot_dissolved",
  helperStateChange: "helper_state_change",
  /** ours: local usage meter; the reference reports usage on `message_end`. */
  /** ours: local usage meter; the reference reports usage on `message_end`. */
  usageReported: "usage_reported",
  usageWarning: "usage_warning",
  localActionRequest: "local_action_request",
  /** ours: result of a local verb; the reference answers the invoke directly. */
  localActionResult: "local_action_result",
} as const;

/** Local actions implemented in `src/main/tools.ts` (reference verb vocabulary). */
export const VERB = {
  readFile: "read_file",
  writeFile: "write_file",
  openPath: "open_path",
  listFiles: "list_files",
  runCommand: "run_command",
  browserOpenPage: "browser_open_page",
  notify: "notify",
  delegateTask: "delegate_task",
  remember: "remember",
  recall: "recall",
  workspaceInfo: "workspace_info",
} as const;

/** The renderer-facing channel the preload bridge already listens on. */
export const CHAT_EVENT_CHANNEL = "viv:chat:event";
/** Full bus mirror. The frozen preload surface does not subscribe to it yet. */
export const BUS_CHANNEL = "viv:bus";

export function frame<T>(
  channel: BusChannel,
  name: string,
  payload: T,
  extra: { id?: string; runId?: string; agentId?: string } = {},
): BusFrame<T> {
  return {
    channel,
    name,
    id: extra.id ?? `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    ...(extra.runId ? { runId: extra.runId } : {}),
    ...(extra.agentId ? { agentId: extra.agentId } : {}),
    payload,
  };
}
