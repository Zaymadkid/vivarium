import crypto from "node:crypto";
import type { ChatEvent, RoutineRecord, RoutineRun } from "../shared/types";
import type { Store } from "./store";

/**
 * THE CLOCK.
 *
 * One timer in the main process checks the routines that are due and either
 * speaks a reminder or starts a real chat turn. A routine's next time is stored,
 * so closing the app does not reset the schedule; a one-off that came due while
 * the app was closed fires once on the next launch and then switches itself off.
 *
 * Everything is visible: the answer lands in the thread, the run appears in the
 * card's history and the ledger records what happened.
 */

type Send = (prompt: string, agentId?: string) => { runId: string };
type Notify = (title: string, body: string) => void;
type Broadcast = (routine: RoutineRecord) => void;

interface Deps {
  store: Store;
  send: Send;
  notify: Notify;
  broadcast: Broadcast;
}

let deps: Deps | null = null;
let timer: NodeJS.Timeout | null = null;
/** runId -> the routine that asked for it, so the answer can be announced. */
const waiting = new Map<string, { routineId: string; text: string }>();
/** Routine ids fired in the last few seconds; a tick must not repeat one. */
const justFired = new Map<string, number>();

const TICK_MS = 20_000;

function announce(routine: RoutineRecord, run: RoutineRun) {
  if (!deps) return;
  const updated = deps.store.noteRoutineRun(routine.id, run);
  if (updated) deps.broadcast(updated);
}

export function fireRoutine(id: string, manual = false): RoutineRun | null {
  if (!deps) return null;
  const routine = deps.store.routine(id);
  if (!routine) return null;
  const at = Date.now();
  if (!manual) {
    const last = justFired.get(id) ?? 0;
    if (at - last < 10_000) return null;
    justFired.set(id, at);
  }

  if (routine.kind === "reminder") {
    deps.notify(routine.name, routine.prompt || "A reminder.");
    const run: RoutineRun = {
      id: crypto.randomUUID(),
      at,
      status: "ok",
      detail: "Shown as a notification",
    };
    announce(routine, run);
    return run;
  }

  try {
    const { runId } = deps.send(routine.prompt, routine.agentId);
    waiting.set(runId, { routineId: routine.id, text: "" });
    if (!manual) deps.notify(routine.name, "Started in the chat.");
    const run: RoutineRun = {
      id: crypto.randomUUID(),
      at,
      status: "ok",
      detail: "Asked in the chat",
      runId,
    };
    announce(routine, run);
    return run;
  } catch (err) {
    const run: RoutineRun = {
      id: crypto.randomUUID(),
      at,
      status: "error",
      detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    };
    announce(routine, run);
    return run;
  }
}

/** Watch a run that a routine started so the answer can be announced. */
export function observeRoutineRun(event: ChatEvent) {
  if (!("runId" in event)) return;
  const entry = waiting.get(event.runId);
  if (!entry) return;
  if (event.type === "delta") {
    entry.text = (entry.text + event.text).slice(0, 4000);
    return;
  }
  if (event.type === "done" || event.type === "error") {
    waiting.delete(event.runId);
    const routine = deps?.store.routine(entry.routineId);
    const body =
      event.type === "error"
        ? `Could not finish: ${event.message.slice(0, 200)}`
        : entry.text.replace(/\s+/g, " ").trim().slice(0, 240) || "An answer is ready in the chat.";
    deps?.notify(routine?.name ?? "Routine finished", body);
  }
}

function tick() {
  if (!deps) return;
  const now = Date.now();
  for (const routine of deps.store.listRoutines()) {
    if (!routine.enabled) continue;
    if (routine.nextAt > now + 2000) continue;
    fireRoutine(routine.id);
  }
}

export function startScheduler(input: Deps) {
  deps = input;
  stopScheduler();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  // A launch is the moment a missed one-off is noticed; let the window exist
  // first so its answer has somewhere to land.
  setTimeout(tick, 4000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
