import { useEffect } from "react";
import { decideApproval, useApprovals } from "./live";
import { pushToast } from "./toasts";
import { Chip } from "./ui";

export function ApprovalStack({ hidden }: { hidden: boolean }) {
  const pending = useApprovals();

  useEffect(() => {
    if (hidden || pending.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const first = pending[0];
      if (e.key === "Enter") {
        void decideApproval(first, "allow").then((ok) => {
          if (ok) pushToast({ title: "Approved", body: first.tool, tone: "ok" });
        });
      }
      if (e.key === "Escape") {
        void decideApproval(first, "deny").then((ok) => {
          if (ok) pushToast({ title: "Denied", body: first.tool, tone: "info" });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, pending]);

  if (hidden || pending.length === 0) return null;

  return (
    <div className="approval-stack" aria-live="polite">
      {pending.map((req) => (
        <article key={req.requestId} className="approval-card">
          <header className="approval-card-head">
            <Chip tone={req.danger === "exec" ? "bad" : req.danger === "write" ? "warn" : "idle"}>{req.danger}</Chip>
            <strong>{req.tool}</strong>
          </header>
          <p className="approval-card-body">{req.summary || "This action needs your consent."}</p>
          <div className="approval-card-actions">
            <button
              className="btn sm primary"
              onClick={() =>
                void decideApproval(req, "allow").then((ok) =>
                  pushToast({ title: ok ? "Approved" : "Couldn't decide", tone: ok ? "ok" : "bad" }),
                )
              }
            >
              Allow
            </button>
            <button
              className="btn sm ghost"
              onClick={() =>
                void decideApproval(req, "always").then((ok) =>
                  pushToast({
                    title: ok ? `Always allow ${req.tool}` : "Couldn't decide",
                    tone: ok ? "ok" : "bad",
                  }),
                )
              }
            >
              Always
            </button>
            <button
              className="btn sm ghost"
              onClick={() =>
                void decideApproval(req, "deny").then((ok) =>
                  pushToast({ title: ok ? "Denied" : "Couldn't decide", tone: ok ? "info" : "bad" }),
                )
              }
            >
              Not now
            </button>
          </div>
          <span className="approval-pending" aria-hidden />
        </article>
      ))}
    </div>
  );
}
