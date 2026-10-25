import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { getPrefs } from "./prefs";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: "ok" | "bad" | "warn" | "info";
  action?: ToastAction;
  at: number;
  leaving?: boolean;
}

let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();

function emit() {
  for (const fn of listeners) fn(toasts);
}

export function pushToast(input: Omit<Toast, "id" | "at"> & { id?: string }) {
  // Settings → Channels → In the app. Successful, quiet notes are the ones the
  // switch is about; a problem is never swallowed because a toggle is off.
  if (!getPrefs().notifInApp && (input.tone === "ok" || input.tone === "info")) return "";
  const toast: Toast = {
    id: input.id ?? `t-${++seq}`,
    title: input.title,
    body: input.body,
    tone: input.tone,
    action: input.action,
    at: Date.now(),
  };
  toasts = [toast, ...toasts].slice(0, 4);
  emit();
  window.setTimeout(() => dismissToast(toast.id), toast.action ? 7000 : 4000);
  return toast.id;
}

export function dismissToast(id: string) {
  let marked = false;
  toasts = toasts.map((t) => {
    if (t.id !== id || t.leaving) return t;
    marked = true;
    return { ...t, leaving: true };
  });
  if (!marked) return;
  emit();
  // sonner exit: transform .5s, opacity .2s.
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 500);
}

export function useToasts(): Toast[] {
  const [snap, setSnap] = useState<Toast[]>(toasts);
  useEffect(() => {
    const fn = (t: Toast[]) => setSnap(t);
    listeners.add(fn);
    setSnap(toasts);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return snap;
}

export function ToastHost() {
  const list = useToasts();
  if (list.length === 0) return null;
  return (
    <div className="toast-host" role="region" aria-live="polite" aria-label="Notifications">
      {list.map((t) => (
        <article key={t.id} className={`toast ${t.tone}${t.leaving ? " leaving" : ""}`}>
          <span className="toast-dot" />
          <div className="toast-main">
            <p className="toast-title">{t.title}</p>
            {t.body && <p className="toast-body">{t.body}</p>}
            {t.action && (
              <div className="toast-actions">
                <button
                  className="btn sm"
                  onClick={() => {
                    t.action?.run();
                    dismissToast(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              </div>
            )}
          </div>
          <button className="icon-btn sm" aria-label="Close toast" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={12} />
          </button>
          <span className="toast-progress" />
        </article>
      ))}
    </div>
  );
}
