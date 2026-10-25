import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IntegrationStatus } from "../shared/types";
import { providerInfo } from "../shared/providers";
import type { Store } from "./store";
import { neo } from "./mcp";

/**
 * WHAT IS ACTUALLY ON THIS MACHINE.
 *
 * The old Integrations screen was a catalogue of promises. This scanner replaces
 * it with measurements: is the browser bridge answering, is Ollama up, which CLI
 * agents are on PATH, is a voice key stored, which folders were granted. Every
 * probe is loopback or a PATH lookup — the scan itself never calls the internet.
 */

const run = promisify(execFile);
const CLI_AGENTS = [
  { cmd: "codebuddy", label: "CodeBuddy" },
  { cmd: "claude", label: "Claude Code" },
  { cmd: "codex", label: "Codex" },
  { cmd: "gemini", label: "Gemini CLI" },
  { cmd: "opencode", label: "OpenCode" },
];

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await run(process.platform === "win32" ? "where.exe" : "which", [cmd], {
      timeout: 2500,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function ollama(): Promise<{ online: boolean; models: string[] }> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { online: false, models: [] };
    const body = (await res.json()) as { models?: { name?: string }[] };
    return { online: true, models: (body.models ?? []).map((m) => m.name ?? "").filter(Boolean) };
  } catch {
    return { online: false, models: [] };
  }
}

export async function scanIntegrations(store: Store): Promise<IntegrationStatus[]> {
  const settings = store.getSettings();
  const [browserTools, ollamaState, clis] = await Promise.all([
    neo.listTools().catch(() => []),
    ollama(),
    Promise.all(CLI_AGENTS.map(async (a) => ({ ...a, found: await commandExists(a.cmd) }))),
  ]);
  const foundClis = clis.filter((c) => c.found);
  const rows: IntegrationStatus[] = [];

  rows.push({
    id: "browser-neo",
    name: "BrowserOS neo",
    category: "Browser",
    status: browserTools.length > 0 ? "ready" : "offline",
    detail:
      browserTools.length > 0
        ? `${browserTools.length} browser tools ready — open pages, read them, click, fill forms and take screenshots in the browser you are already signed into.`
        : "The local browser bridge is not answering on port 9210.",
    needs:
      browserTools.length > 0
        ? "Nothing. Keep BrowserOS neo open while she browses."
        : "Open BrowserOS neo. Its MCP server must be running on 127.0.0.1:9210.",
  });

  rows.push({
    id: "ollama",
    name: "Ollama",
    category: "Model",
    status: ollamaState.online ? "ready" : "offline",
    detail: ollamaState.online
      ? `Running locally with ${ollamaState.models.length} model${ollamaState.models.length === 1 ? "" : "s"}${
          ollamaState.models.length ? `: ${ollamaState.models.slice(0, 3).join(", ")}` : ""
        }.`
      : "No Ollama server answered at 127.0.0.1:11434.",
    needs: "Ollama running on this machine. No key and no account.",
    action: "mind",
  });

  rows.push({
    id: "cli-agents",
    name: "CLI agents",
    category: "Tools",
    status: foundClis.length > 0 ? "ready" : "offline",
    detail:
      foundClis.length > 0
        ? `${foundClis.map((c) => c.label).join(", ")} on PATH. Any of them can be the mind that thinks.`
        : "None of CodeBuddy, Claude Code, Codex, Gemini CLI or OpenCode was found on PATH.",
    needs: "Install one of those CLIs, or use a hosted model instead.",
    action: "mind",
  });

  rows.push({
    id: "model",
    name: "The mind",
    category: "Model",
    status: settings.provider === "mock" ? "unconfigured" : "ready",
    detail:
      settings.provider === "mock"
        ? "Mock is answering offline: the loop works, but this is not a real model."
        : `${providerInfo(settings.provider).label} · ${settings.model || "no model set"}.`,
    needs:
      settings.provider === "mock"
        ? "Pick a provider in Configure → Mind."
        : settings.provider === "ollama"
          ? `Ollama at ${settings.baseUrl || "http://127.0.0.1:11434"}`
          : settings.provider === "openai"
            ? settings.hasKey
              ? "Nothing. A key is stored in the OS keychain."
              : "An API key for the endpoint."
            : settings.cliCommand
              ? "Nothing. The command is configured."
              : "The CLI binary on PATH.",
    action: "mind",
  });

  rows.push({
    id: "voice",
    name: "Voice",
    category: "Voice",
    status: settings.hasVoiceKey ? "ready" : "unconfigured",
    detail: settings.hasVoiceKey
      ? "An ElevenLabs key is stored in the OS keychain; transcription and her hosted voice work."
      : "No ElevenLabs key. The free Windows voice still speaks replies, and the offline recogniser still transcribes.",
    needs: settings.hasVoiceKey ? "Nothing." : "An ElevenLabs key for the hosted voice and scribe transcription.",
    action: "voice",
  });

  rows.push({
    id: "screen",
    name: "Screen",
    category: "Tools",
    status: settings.abilities?.screen ? "ready" : "unconfigured",
    detail: settings.abilities?.screen
      ? "She may take a still of the primary display when a task needs it, and only then."
      : "Screen access is off, so the see_screen tool refuses.",
    needs: settings.abilities?.screen ? "Nothing." : "Turn on Screen access in Settings → Machine access.",
    action: "settings",
  });

  rows.push({
    id: "files",
    name: "Folders",
    category: "Files",
    status: settings.roots.length > 0 ? "ready" : "unconfigured",
    detail:
      settings.roots.length > 0
        ? `${settings.roots.length} folder${settings.roots.length === 1 ? "" : "s"} granted: ${settings.roots
            .map((r) => r.split(/[\\/]/).pop())
            .join(", ")}.`
        : "No folders granted. File and terminal tools refuse until you add one.",
    needs:
      settings.roots.length > 0 ? "Nothing." : "Add at least one folder in Settings → Machine access.",
    action: "folders",
  });

  const learning = settings.learning ?? { memory: true, skills: true };
  rows.push({
    id: "learning",
    name: "Self-learning",
    category: "Tools",
    status: learning.memory || learning.skills ? "ready" : "unconfigured",
    detail:
      learning.memory || learning.skills
        ? `Keeps what it learns${learning.memory ? " — facts and preferences" : ""}${
            learning.skills ? " — and reusable procedures" : ""
          }. ${store.listMemory().length} memories · ${store.listSkills().length} skills.`
        : "Learning is off; she will not keep facts or write skills.",
    needs:
      learning.memory || learning.skills
        ? "Nothing."
        : "Auto-memory and Auto-skills in Settings → Companion → Abilities.",
    action: "settings",
  });

  return rows;
}
