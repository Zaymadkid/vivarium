import { spawn } from "node:child_process";
import { shell } from "electron";
import { listWindows, pressKeys, typeText } from "./hands";
import { captureScreen } from "./screen";
import type { Store } from "./store";

/**
 * VOICE ACTIONS, BEFORE THE MODEL.
 *
 * “Open Notepad, type hello” should not wait for a round trip to a language
 * model. These are the reflexes: a fixed set of verbs that run in a quarter of
 * a second, deliberately small and deterministic:
 *
 *   open <app>        open a known Windows app, Settings, or a URL
 *   type <text>       paste text into the window in front
 *   press <keys>      send a key combination (Enter, Ctrl+S, …)
 *   take a screenshot
 *   search for <text> open a web search
 *   remember <fact>   keep a durable memory without a turn
 *
 * A sentence containing several verbs is executed in order. Anything that does
 * not match every clause is handed to the companion instead, so an unusual
 * request does not silently lose half of itself. Typing and keys still require
 * "Control this computer" because they act on someone else's window.
 */

export interface VoiceActionOutcome {
  handled: boolean;
  /** A short line for the overlay, shown instead of a chat turn. */
  note?: string;
}

const APPS: Record<string, string> = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  calc: "calc.exe",
  paint: "mspaint.exe",
  "file explorer": "explorer.exe",
  explorer: "explorer.exe",
  files: "explorer.exe",
  chrome: "chrome.exe",
  "google chrome": "chrome.exe",
  edge: "msedge.exe",
  "microsoft edge": "msedge.exe",
  firefox: "firefox.exe",
  terminal: "wt.exe",
  "windows terminal": "wt.exe",
  powershell: "powershell.exe",
  cmd: "cmd.exe",
  "command prompt": "cmd.exe",
  "vs code": "code",
  vscode: "code",
  code: "code",
  spotify: "spotify.exe",
  word: "winword.exe",
  excel: "excel.exe",
  powerpoint: "powerpnt.exe",
  settings: "ms-settings:",
  "the settings": "ms-settings:",
  "task manager": "taskmgr.exe",
  "snipping tool": "ms-screenclip:",
};

interface Step {
  kind: "open" | "type" | "press" | "search" | "screenshot" | "remember" | "time";
  value?: string;
}

const clean = (text: string) =>
  text
    .trim()
    .replace(/^(?:hey|ok|okay|please|can you|could you|would you)\s+/gi, "")
    .replace(/\s+please$/i, "")
    .replace(/[.!]+$/, "")
    .trim();

function stepOf(part: string): Step | null {
  const text = clean(part);
  if (!text) return null;

  const type = /^type\s+([\s\S]+)$/i.exec(text);
  if (type) return { kind: "type", value: type[1] };

  const press = /^press\s+([\s\S]+)$/i.exec(text);
  if (press) return { kind: "press", value: press[1] };

  const shot = /^(?:take\s+(?:a\s+)?screenshot|screenshot)$/i.exec(text);
  if (shot) return { kind: "screenshot" };

  const remember = /^(?:remember|note)\s+(?:that\s+)?([\s\S]+)$/i.exec(text);
  if (remember) return { kind: "remember", value: remember[1] };

  const search = /^(?:search(?:\s+the\s+web)?(?:\s+for)?|google|look\s+up)\s+([\s\S]+)$/i.exec(text);
  if (search) return { kind: "search", value: search[1] };

  if (/^what(?:'s| is) the time\??$/i.test(text) || /^what time is it\??$/i.test(text)) {
    return { kind: "time" };
  }

  const open = /^open\s+([\s\S]+)$/i.exec(text);
  if (open) {
    const target = open[1]
      .replace(/\s+(?:for me|please)$/i, "")
      .replace(/\s+app$/i, "")
      .trim()
      .toLowerCase();
    return { kind: "open", value: target };
  }
  return null;
}

function stepsIn(text: string): Step[] | null {
  // "type …" owns everything after it: a comma inside the dictation is text.
  if (/^(?:hey |ok |okay |please )*type\s+/i.test(text.trim())) {
    const only = stepOf(text);
    return only ? [only] : null;
  }
  const parts = text
    .split(/\s*,\s*|\s+then\s+|\s+and\s+(?=type |press |open |search |take |remember |google |look up )/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const steps = parts.map(stepOf);
  if (steps.some((step) => !step)) return null;
  return steps as Step[];
}

function launchApp(name: string): boolean {
  const target = APPS[name];
  if (!target) return false;
  if (/^[a-z][\w-]*:$/i.test(target)) {
    void shell.openExternal(target);
    return true;
  }
  try {
    const child = spawn(target, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** What the reflex layer understood, for the overlay and for tests. */
export function planVoiceActions(text: string): { kind: string; value?: string }[] | null {
  return stepsIn(text);
}

export async function runVoiceAction(text: string, store: Store): Promise<VoiceActionOutcome> {
  const steps = stepsIn(text);
  if (!steps) return { handled: false };

  const hands = Boolean(store.getSettings().abilities?.hands);
  const notes: string[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "open": {
        const target = step.value ?? "";
        if (/^https?:\/\//i.test(target)) {
          await shell.openExternal(target);
          notes.push(`Opened ${target}`);
          break;
        }
        if (!launchApp(target)) return { handled: false };
        notes.push(`Opened ${target}`);
        break;
      }
      case "type": {
        if (!hands) {
          return {
            handled: true,
            note: "Typing needs Control this computer. Turn it on in Settings → Machine access, then say it again.",
          };
        }
        // If nothing has been probed yet, aim at the window in front.
        try {
          await typeText(step.value ?? "", false);
        } catch {
          if ((await listWindows()).length === 0) {
            return { handled: true, note: "There was no window in front to type into." };
          }
          await typeText(step.value ?? "", false);
        }
        notes.push("Typed it");
        break;
      }
      case "press": {
        if (!hands) {
          return {
            handled: true,
            note: "Keys need Control this computer. Turn it on in Settings → Machine access.",
          };
        }
        await pressKeys(step.value ?? "");
        notes.push(`Pressed ${step.value}`);
        break;
      }
      case "search": {
        const query = step.value ?? "";
        await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        notes.push(`Searching for ${query}`);
        break;
      }
      case "screenshot": {
        const shot = await captureScreen(store.dir);
        notes.push(`Screenshot saved to ${shot.path}`);
        break;
      }
      case "remember": {
        store.addMemory(step.value ?? "", "manual");
        notes.push("Kept that.");
        break;
      }
      case "time": {
        notes.push(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        break;
      }
    }
  }
  return { handled: true, note: notes.join(" · ") };
}
