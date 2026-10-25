import { useEffect, useState } from "react";
import type { ApprovalRequest, ChatEvent } from "../../../shared/types";

/**
 * One subscription to the main process, fanned out to every surface. The chat drawer, the
 * approval stack and the run ribbon all read the same queue so a decision is never applied
 * twice.
 */

type Listener = (event: ChatEvent) => void;
const listeners = new Set<Listener>();
let attached = false;

function attach() {
  if (attached || typeof window === "undefined" || !window.viv?.chat) return;
  attached = true;
  window.viv.chat.onEvent((event) => {
    if (event.type === "approval") {
      setApprovals((prev) =>
        prev.some((a) => a.requestId === event.request.requestId) ? prev : [...prev, event.request],
      );
    }
    for (const fn of [...listeners]) fn(event);
  });
}

export function subscribeChat(fn: Listener): () => void {
  attach();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useChatEvent(fn: Listener) {
  useEffect(() => subscribeChat(fn), [fn]);
}

/* ---------- approvals ---------- */

let approvals: ApprovalRequest[] = [];
const approvalListeners = new Set<(a: ApprovalRequest[]) => void>();

function emitApprovals() {
  for (const fn of approvalListeners) fn(approvals);
}

export function setApprovals(fn: (prev: ApprovalRequest[]) => ApprovalRequest[]) {
  approvals = fn(approvals);
  emitApprovals();
}

export function useApprovals(): ApprovalRequest[] {
  const [snap, setSnap] = useState<ApprovalRequest[]>(approvals);
  useEffect(() => {
    // A CLI agent can ask for consent while the chat drawer is shut and nothing
    // else has subscribed. The stack owns the subscription for that reason: a
    // card must reach the window whether or not a chat is on screen.
    attach();
    const fn = (a: ApprovalRequest[]) => setSnap(a);
    approvalListeners.add(fn);
    setSnap(approvals);
    return () => {
      approvalListeners.delete(fn);
    };
  }, []);
  return snap;
}

export async function decideApproval(
  request: ApprovalRequest,
  decision: "allow" | "always" | "deny",
): Promise<boolean> {
  try {
    await window.viv.tools.decide(request.requestId, decision);
    setApprovals((prev) => prev.filter((a) => a.requestId !== request.requestId));
    return true;
  } catch {
    return false;
  }
}
