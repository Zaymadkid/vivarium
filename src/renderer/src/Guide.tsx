import { useEffect, useMemo, useState } from "react";
import type { GuideState } from "../../shared/types";

/**
 * THE POINTING LAYER.
 *
 * Every guide window is transparent and click-through; this file only paints.
 * A rectangle arrives as fractions of the display, becomes pixels here, and the
 * veil is one element with a very large shadow — the hole is genuinely empty, so
 * the control underneath stays readable through it.
 */

const EMPTY: GuideState = { active: false, steps: [], index: 0 };

export function Guide() {
  const [state, setState] = useState<GuideState>(EMPTY);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    // The guide window has no App shell, so the accent comes straight from
    // settings; the pointer should match the orb the person is used to.
    void window.viv.settings
      .get()
      .then((settings) => {
        if (settings.accent) document.documentElement.style.setProperty("--accent", settings.accent);
      })
      .catch(() => undefined);
    const off = window.viv.guide.onState(setState);
    void window.viv.guide.status().then(setState).catch(() => undefined);
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      off();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Escape is registered globally in the main process while a guide is up; this
  // is a local fallback for the moment the window happens to have focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.viv.guide.hide();
      if (event.key === "ArrowRight") void window.viv.guide.step(1);
      if (event.key === "ArrowLeft") void window.viv.guide.step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const step = state.steps[state.index];
  const rect = useMemo(() => {
    if (!step || step.x === undefined || step.y === undefined || step.width === undefined || step.height === undefined) {
      return null;
    }
    const pad = 6;
    return {
      left: Math.max(0, step.x * size.w - pad),
      top: Math.max(0, step.y * size.h - pad),
      width: Math.min(size.w, step.width * size.w + pad * 2),
      height: Math.min(size.h, step.height * size.h + pad * 2),
    };
  }, [step, size]);

  if (!state.active || !step) return null;

  // A hand action: only a pointer, so the desktop stays exactly as it is.
  if (state.mode === "hand") {
    return (
      <div className="hand-root" role="presentation">
        <div
          className="hand-point"
          style={{ left: `${(step.x ?? 0) * 100}%`, top: `${(step.y ?? 0) * 100}%` }}
        >
          <span className="hand-ring" />
          <svg className="hand-cursor" viewBox="0 0 28 34" aria-hidden="true">
            <path
              d="M3 2.4 24.2 15.8l-9.1 1.9-4.3 8.7L3 2.4Z"
              fill="#0B1220"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          {step.text ? <span className="hand-label">{step.text}</span> : null}
        </div>
      </div>
    );
  }

  const bubbleWidth = Math.min(360, size.w - 32);
  const gap = 14;
  let bubbleLeft: number;
  let bubbleTop: number;
  if (rect) {
    bubbleLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - bubbleWidth / 2), size.w - bubbleWidth - 16);
    const above = rect.top - gap - 120;
    bubbleTop = above > 72 ? above : Math.min(size.h - 190, rect.top + rect.height + gap);
    if (bubbleTop < 72) bubbleTop = 72;
  } else {
    bubbleLeft = (size.w - bubbleWidth) / 2;
    bubbleTop = size.h - 208;
  }

  return (
    <div className="guide-root" role="presentation">
      {rect ? (
        <div
          className="guide-hole"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <span className="guide-ring" />
          <span className="guide-beam" />
          <svg className="guide-cursor" viewBox="0 0 28 34" aria-hidden="true">
            <path
              d="M3 2.4 24.2 15.8l-9.1 1.9-4.3 8.7L3 2.4Z"
              fill="#0B1220"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          {step.label ? <span className="guide-label">{step.label}</span> : null}
        </div>
      ) : (
        <div className="guide-veil" />
      )}

      <div
        className="guide-bubble"
        style={{ left: bubbleLeft, top: bubbleTop, width: bubbleWidth }}
      >
        <div className="guide-kicker">
          <span className="guide-count">
            {state.index + 1} / {state.steps.length}
          </span>
          <span className="guide-title">{step.title || state.goal || "On your screen"}</span>
        </div>
        <p className="guide-text">{step.text}</p>
        <div className="guide-foot">
          <span className="guide-dots">
            {state.steps.map((_, i) => (
              <i key={i} className={i === state.index ? "on" : i < state.index ? "past" : ""} />
            ))}
          </span>
          <span className="guide-keys">Ctrl+Alt+→ · Esc</span>
        </div>
        {state.goal && step.title ? <span className="guide-goal">{state.goal}</span> : null}
      </div>
    </div>
  );
}
