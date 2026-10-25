import { BrowserWindow, globalShortcut, screen } from "electron";
import path from "node:path";
import type { GuidePayload, GuideState, GuideStep } from "../shared/types";

/**
 * THE GUIDE LAYER.
 *
 * A pointing surface, not another app window: one transparent, click-through,
 * always-on-top sheet on every display, with a hole cut around the control she
 * means and a short line next to it. The person keeps full control of the
 * machine underneath; nothing here can receive a click.
 *
 * Coordinates arrive as fractions of the display (0–1, origin top-left), which
 * is what a vision model can actually estimate from a screenshot. Each window
 * multiplies them by its own bounds, so a second monitor works without the model
 * knowing it exists.
 */

const MAX_STEPS = 12;

let sheets: BrowserWindow[] = [];
let state: GuideState = { active: false, steps: [], index: 0 };
let registered: string[] = [];
let pointerTimer: ReturnType<typeof setTimeout> | null = null;

function clamp01(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function cleanStep(raw: Partial<GuideStep>): GuideStep | null {
  const text = String(raw.text ?? raw.title ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const step: GuideStep = { text: text.slice(0, 320) };
  if (raw.title) step.title = String(raw.title).slice(0, 80);
  const x = clamp01(raw.x);
  const y = clamp01(raw.y);
  const width = clamp01(raw.width);
  const height = clamp01(raw.height);
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    // A box with no area is not a target; keep the step, drop the rectangle.
    if (width > 0.002 && height > 0.002) {
      step.x = x;
      step.y = y;
      step.width = Math.min(width, 1 - x);
      step.height = Math.min(height, 1 - y);
    }
  }
  if (raw.label) step.label = String(raw.label).slice(0, 48);
  return step;
}

function loadSheet(target: BrowserWindow) {
  if (process.env.ELECTRON_RENDERER_URL) {
    void target.loadURL(`${process.env.ELECTRON_RENDERER_URL}#guide`);
  } else {
    void target.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "guide" });
  }
}

function createSheets() {
  for (const display of screen.getAllDisplays()) {
    const bounds = display.bounds;
    const sheet = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    sheet.setAlwaysOnTop(true, "screen-saver");
    sheet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // The whole point: the person can keep clicking the app she is describing.
    sheet.setIgnoreMouseEvents(true, { forward: true });
    sheet.webContents.on("did-finish-load", () => {
      sheet.webContents.send("viv:guide:state", state);
    });
    loadSheet(sheet);
    sheets.push(sheet);
  }
}

function broadcast() {
  for (const sheet of sheets) {
    if (!sheet.isDestroyed()) sheet.webContents.send("viv:guide:state", state);
  }
}

function showSheets() {
  for (const sheet of sheets) {
    if (!sheet.isDestroyed() && !sheet.isVisible()) sheet.showInactive();
  }
}

function hideSheets() {
  for (const sheet of sheets) {
    if (!sheet.isDestroyed()) sheet.hide();
  }
}

/**
 * Keys, not clicks: the sheet is click-through, so a focused window is not an
 * option. Only while a guide is up, and released the moment it closes.
 */
function registerKeys() {
  if (registered.length) return;
  const bind = (accelerator: string, fn: () => void) => {
    try {
      if (globalShortcut.register(accelerator, fn)) registered.push(accelerator);
    } catch {
      /* an OS-owned combination simply stays unbound */
    }
  };
  bind("CommandOrControl+Alt+Right", () => stepGuide(1));
  bind("CommandOrControl+Alt+Left", () => stepGuide(-1));
  bind("Escape", () => hideGuide());
}

function releaseKeys() {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* already gone */
    }
  }
  registered = [];
}

export function guideStatus(): GuideState {
  return state;
}

export function showGuide(payload: GuidePayload): GuideState {
  const steps = (Array.isArray(payload?.steps) ? payload.steps : [])
    .slice(0, MAX_STEPS)
    .map(cleanStep)
    .filter((step): step is GuideStep => Boolean(step));
  if (steps.length === 0) {
    hideGuide();
    return state;
  }
  if (pointerTimer) {
    clearTimeout(pointerTimer);
    pointerTimer = null;
  }
  state = { active: true, mode: "guide", steps, index: 0 };
  if (payload?.goal) state.goal = String(payload.goal).slice(0, 200);
  if (sheets.length === 0) createSheets();
  // The display layout can change between guides (a docked laptop, a projector).
  const displays = screen.getAllDisplays();
  if (displays.length !== sheets.length) {
    for (const sheet of sheets) if (!sheet.isDestroyed()) sheet.destroy();
    sheets = [];
    createSheets();
  }
  showSheets();
  registerKeys();
  broadcast();
  return state;
}

/**
 * A transient pointer for an action, not a walkthrough: no veil, no bubble.
 * The hands tools call this just before the click so the person sees exactly
 * where the cursor is going, while the sheet stays click-through.
 */
export function showPointer(x: number, y: number, label?: string): GuideState {
  if (state.active && state.mode === "guide") return state;
  if (sheets.length === 0) createSheets();
  const displays = screen.getAllDisplays();
  if (displays.length !== sheets.length) {
    for (const sheet of sheets) if (!sheet.isDestroyed()) sheet.destroy();
    sheets = [];
    createSheets();
  }
  state = {
    active: true,
    mode: "hand",
    steps: [{ text: label ?? "", x: clamp01(x) ?? 0, y: clamp01(y) ?? 0, width: 0.001, height: 0.001 }],
    index: 0,
  };
  showSheets();
  broadcast();
  if (pointerTimer) clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => {
    pointerTimer = null;
    if (state.active && state.mode === "hand") hideGuide();
  }, 1900);
  return state;
}

export function stepGuide(delta: number): GuideState {
  if (!state.active) return state;
  const next = Math.min(state.steps.length - 1, Math.max(0, state.index + delta));
  state = { ...state, index: next };
  broadcast();
  return state;
}

export function setGuideStep(index: number): GuideState {
  if (!state.active) return state;
  state = { ...state, index: Math.min(state.steps.length - 1, Math.max(0, Math.round(index))) };
  broadcast();
  return state;
}

export function hideGuide(): GuideState {
  if (pointerTimer) {
    clearTimeout(pointerTimer);
    pointerTimer = null;
  }
  state = { active: false, steps: [], index: 0 };
  hideSheets();
  releaseKeys();
  broadcast();
  return state;
}

export function destroyGuide() {
  hideGuide();
  for (const sheet of sheets) if (!sheet.isDestroyed()) sheet.destroy();
  sheets = [];
}
