import { useEffect, useState } from "react";

/**
 * Renderer-local preferences. Anything the main process owns (provider, model, base URL,
 * roots, accent, reduced motion) stays in `Settings`; everything the reference keeps in its
 * own client store lives here and is persisted beside it.
 */
export interface Prefs {
  startView: "world" | "documents" | "configure";
  locale: string;
  timezone: string;
  currency: "USD" | "GBP" | "EUR";

  renderQuality: "low" | "balanced" | "high";
  bloom: boolean;
  ambientDrift: boolean;

  companionName: string;
  companionHue: string;
  /** Whose colour a worker takes: its own hue, or hers. */
  workerColour: "own" | "companion";
  voice: "default" | "warm" | "crisp" | "deep";
  /** Chosen input device; "default" follows Windows. */
  micId: string;
  /** Read a reply aloud while it is still being written. */
  speakReplies: boolean;
  /**
   * Read the whole answer instead of the opening thought. Off by default:
   * nobody wants a list, a code block or a file path recited at them.
   */
  speakFull: boolean;
  /**
   * Hands-free conversation: the microphone stays open, a thought is sent when
   * the person stops talking, replies are read in full, and speaking over her
   * interrupts her.
   */
  liveConversation: boolean;
  /** Settings → Machine access: she may capture the screen when a task needs it. */
  screenAccess: boolean;
  /** Let her move the mouse and type on this computer, always with approval. */
  desktopControl: boolean;
  /** The Knot lives as a slim bar at the top of the screen instead of an orb. */
  islandMode: boolean;
  /** Settings → Companion → Abilities: keep facts from a finished turn. */
  autoMemory: boolean;
  /** Settings → Companion → Abilities: write reusable procedures as skills. */
  autoSkills: boolean;
  personality: "quiet" | "balanced" | "narrated";
  tone: "casual" | "warm" | "formal";
  proactivity: "asked" | "often";
  goal: string;
  interview: string;

  temperature: number;
  maxTokens: number;
  streaming: boolean;
  preamble: string;

  readOutsideRoots: boolean;
  allowWrite: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
  approvalMode: "manual" | "auto";
  allowlist: string[];

  seaTheme: "ember" | "ash" | "moss";
  bloomStrength: number;
  fogDensity: number;
  grid: boolean;
  cameraDrift: number;

  autosave: boolean;
  defaultFolder: string;
  sortOrder: "manual" | "alpha";

  notifInApp: boolean;
  notifDevices: boolean;
  notifFinish: boolean;
  lowCredits: boolean;
  lowCreditAt: number;
  emailSummary: boolean;
  emailFrequency: "daily" | "weekly" | "never";
  telegram: string;

  tier: string;
  credits: number;
  pack: number;
  customAmount: string;
  savedCard: string;
  renewal: string;

  accessibility: boolean;
  screenRecording: boolean;
  appAccess: string[];
  /** Settings → Preferences: what she may do without asking first. */
  autoEveryday: boolean;
  autoBuild: boolean;
  autoDestroy: boolean;

  accountName: string;
  accountEmail: string;
  memberSince: number;
  organization: string;
  ledgerRetention: "30" | "90" | "365" | "forever";
}

export const LOCALES = ["en-GB", "en-US", "de-DE", "fr-FR", "ja-JP"] as const;
export const TIMEZONES = [
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
] as const;

export const PREFS_DEFAULT: Prefs = {
  startView: "world",
  locale: "en-GB",
  timezone: "Europe/London",
  currency: "USD",

  renderQuality: "balanced",
  bloom: true,
  ambientDrift: true,

  companionName: "Ash",
  companionHue: "#35E29B",
  workerColour: "own",
  voice: "default",
  micId: "default",
  speakReplies: true,
  speakFull: false,
  liveConversation: false,
  screenAccess: false,
  desktopControl: false,
  islandMode: false,
  autoMemory: true,
  autoSkills: true,
  personality: "balanced",
  tone: "warm",
  proactivity: "asked",
  goal: "",
  interview: "",

  temperature: 0.7,
  maxTokens: 2048,
  streaming: true,
  preamble: "",

  readOutsideRoots: false,
  allowWrite: true,
  allowShell: false,
  allowNetwork: true,
  approvalMode: "manual",
  allowlist: [],

  seaTheme: "ember",
  bloomStrength: 0.28,
  fogDensity: 15,
  grid: false,
  cameraDrift: 0.16,

  autosave: true,
  defaultFolder: "Unfiled",
  sortOrder: "manual",

  notifInApp: true,
  notifDevices: false,
  notifFinish: true,
  lowCredits: true,
  lowCreditAt: 100,
  emailSummary: false,
  emailFrequency: "weekly",
  telegram: "",

  tier: "Local",
  credits: 1240,
  pack: 2000,
  customAmount: "",
  savedCard: "none",
  renewal: "—",

  accessibility: false,
  screenRecording: false,
  appAccess: [],
  autoEveryday: false,
  autoBuild: false,
  autoDestroy: false,

  accountName: "You",
  accountEmail: "",
  memberSince: Date.now(),
  organization: "",
  ledgerRetention: "90",
};

const KEY = "vivarium.prefs.v2";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...PREFS_DEFAULT };
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const parsed: Partial<Prefs> = { ...(saved as Partial<Prefs>) };
    // Older builds let the credit counter run away; keep the store sane so the
    // usage card and the credits chip always read as a sensible number.
    if (typeof saved.credits !== "number" || saved.credits < 0 || saved.credits > 1_000_000) {
      parsed.credits = PREFS_DEFAULT.credits;
    }
    // A saved preference from an older build is not a broken one: read an
    // unknown value as the one it meant instead of silently resetting it.
    if (
      saved.workerColour !== undefined &&
      saved.workerColour !== "own" &&
      saved.workerColour !== "companion"
    ) {
      parsed.workerColour = "companion";
    }
    return { ...PREFS_DEFAULT, ...parsed };
  } catch {
    return { ...PREFS_DEFAULT };
  }
}

let current: Prefs = read();
const listeners = new Set<(p: Prefs) => void>();

// The Knot overlay is a second window on the same settings. Without this, a
// voice or companion change made in Settings would not reach it until relaunch.
window.addEventListener("storage", (event) => {
  if (event.key !== KEY && event.key !== null) return;
  current = read();
  for (const fn of listeners) fn(current);
});

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* a full disk must not take the UI down */
  }
  for (const fn of listeners) fn(current);
}

export function resetPrefs() {
  current = { ...PREFS_DEFAULT };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(current);
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [snap, setSnap] = useState<Prefs>(current);
  useEffect(() => {
    const fn = (p: Prefs) => setSnap(p);
    listeners.add(fn);
    setSnap(current);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [snap, setPrefs];
}

export function formatDate(at: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(at));
  } catch {
    return new Date(at).toLocaleDateString();
  }
}

export function formatMoney(value: number, currency: Prefs["currency"]): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

export function nowStamp(): string {
  const d = new Date();
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
