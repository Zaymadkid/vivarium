import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Danger } from "../shared/types";

/**
 * The CLI approval bridge.
 *
 * A CLI agent (CodeBuddy, Claude Code, …) runs tools in its own process, so the
 * app cannot see them — until the CLI asks. Every CLI Vivarium launches gets two
 * variables pointing at a loopback endpoint here, plus a settings file (where the
 * CLI supports one) that installs a PreToolUse hook. The hook blocks on an HTTP
 * request; the request becomes an approval card in the window; the answer travels
 * back as the hook's decision. Nothing runs until the person says so.
 *
 *   CLI tool call → hook command → POST /pre-tool-use → approval card
 *                                      ↑                    │
 *                                      └──── allow / deny ──┘
 *
 * The endpoint is loopback-only, bound to a random port, and requires a random
 * token generated for this app run. A hook that arrives without the token is
 * refused, so another local process cannot answer for the person.
 */

export type GateDecision = "allow" | "always" | "deny";

export interface GateRequest {
  tool: string;
  args: Record<string, unknown>;
  danger: Danger;
  summary: string;
}

type Asker = (request: GateRequest) => Promise<GateDecision>;

export interface HookOptions {
  ask: Asker;
  /** A CLI handed work to its own subagent. Reference `agent_dispatched`. */
  dispatch?: (input: { id: string; name: string; brief: string }) => void;
  /** That subagent answered. Reference `task_completed`. */
  report?: (input: { id: string; text: string; ok: boolean }) => void;
}

/** Tools a Claude-Code-compatible CLI uses to run a background subagent. */
const SUBAGENT_TOOLS = new Set(["task", "agent", "subagent", "spawnagent", "dispatchagent"]);

/** How long the CLI waits for a person before the call is refused. */
const DECISION_TIMEOUT_MS = 8 * 60 * 1000;
/** The hook process waits slightly longer than the server so it gets a clean deny. */
const HOOK_TIMEOUT_SECONDS = Math.ceil(DECISION_TIMEOUT_MS / 1000) + 60;
const MAX_BODY = 512 * 1024;

/**
 * Tool names, per family, that leave the app: a shell, a file write, an edit.
 * Unknown tools pass through — the point is to gate consequence, not to freeze
 * the CLI. Names are compared case-insensitively and without punctuation.
 */
function dangerOf(tool: string): Danger | null {
  const name = tool.toLowerCase().replace(/[^a-z]/g, "");
  if (/(^|_|__)(bash|shell|execute|exec|terminal|command|run|powershell)$/.test(name)) return "exec";
  if (/^(bash|shell|execute|exectool|runcommand|terminal|powershell)$/.test(name)) return "exec";
  if (/^(write|edit|multiedit|notebookedit|applypatch|createfile|patch|strreplace|writefile|editfile)$/.test(name)) {
    return "write";
  }
  if (/write|edit|patch/.test(name)) return "write";
  return null;
}

function summarise(tool: string, input: Record<string, unknown>): string {
  const pick = (key: string) => {
    const value = input[key];
    return typeof value === "string" ? value : "";
  };
  const file = pick("file_path") || pick("path") || pick("notebook_path");
  const command = pick("command") || pick("cmd");
  const detail = command || file;
  if (!detail) return tool;
  const oneLine = detail.replace(/\s+/g, " ").trim();
  return oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
}

/* --------------------------------------------------------------------- hook files */

/** The settings file a Claude-Code-compatible CLI is pointed at with `--settings`. */
function hookSettings(script: string): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          hooks: [{ type: "command", command: `node "${script}"`, timeout: HOOK_TIMEOUT_SECONDS }],
        },
      ],
      PostToolUse: [
        {
          hooks: [{ type: "command", command: `node "${script}"`, timeout: 30 }],
        },
      ],
    },
  });
}

/**
 * The hook program itself. It is deliberately dependency-free: read the event on
 * stdin, ask the app, print the decision. Without the app's variables (the CLI
 * started outside Vivarium) it exits silently and the CLI behaves as it always
 * has.
 */
const HOOK_SCRIPT = `#!/usr/bin/env node
// Vivarium approval hook. Installed per launch; safe to run outside the app.
const endpoint = process.env.VIVARIUM_HOOK_ENDPOINT;
const token = process.env.VIVARIUM_HOOK_TOKEN;

const finish = () => process.exit(0);
const passthrough = () => {
  process.stdout.write("");
  finish();
};

if (!endpoint || !token) {
  // Not launched by Vivarium: drain stdin and leave the CLI alone.
  process.stdin.resume();
  process.stdin.on("end", finish);
  setTimeout(finish, 1000);
} else {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 512 * 1024) raw = raw.slice(0, 512 * 1024);
  });
  process.stdin.on("end", async () => {
    try {
      const res = await fetch(endpoint + "/hook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vivarium-hook-token": token },
        body: raw || "{}",
      });
      if (!res.ok) return passthrough();
      const body = await res.text();
      process.stdout.write(body);
      finish();
    } catch {
      passthrough();
    }
  });
  // If the app dies mid-decision, do not hang the CLI forever.
  setTimeout(passthrough, ${HOOK_TIMEOUT_SECONDS} * 1000);
}
`;

export interface HookInstall {
  scriptPath: string;
  settingsPath: string;
}

/** Writes the hook program + its settings file under the app's data folder. */
export function installHookFiles(dir: string): HookInstall {
  const hooks = path.join(dir, "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const scriptPath = path.join(hooks, "vivarium-approval.mjs");
  const settingsPath = path.join(hooks, "claude-hook-settings.json");
  const script = HOOK_SCRIPT;
  const settings = hookSettings(scriptPath);
  // Rewriting every launch keeps the files in step with the app that reads them.
  if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, "utf8") !== script) {
    fs.writeFileSync(scriptPath, script, "utf8");
  }
  if (!fs.existsSync(settingsPath) || fs.readFileSync(settingsPath, "utf8") !== settings) {
    fs.writeFileSync(settingsPath, settings, "utf8");
  }
  return { scriptPath, settingsPath };
}

/* ------------------------------------------------------------------ environment */

let environment: Record<string, string> = {};
let installedSettingsPath = "";

/** Variables every CLI child inherits. Empty until the bridge is listening. */
export function hookEnvironment(): Record<string, string> {
  return environment;
}

/** The generated settings file, for CLIs that take one on the command line. */
export function cliHookSettings(): string {
  return installedSettingsPath;
}

/**
 * Adds `--settings <file>` to a Claude-Code-compatible CLI. Returns the argv it
 * was given when the CLI is not one of those, or the person already passed their
 * own `--settings` — in that case the hook still works, it just cannot be
 * installed for them.
 */
export function decorateCliArgs(argv: string[], settingsPath: string): string[] {
  if (!settingsPath || !fs.existsSync(settingsPath)) return argv;
  if (argv.some((a) => a === "--settings" || a.startsWith("--settings="))) return argv;
  const head = argv.slice(0, 3).join(" ").toLowerCase();
  if (!/codebuddy|\bcbc\b|\bclaude\b/.test(head)) return argv;
  // `--settings` must precede the prompt: everything after `-p` is prompt text.
  const printAt = argv.findIndex((a) => a === "-p" || a === "--print");
  const at = printAt === -1 ? argv.length : printAt;
  return [...argv.slice(0, at), "--settings", settingsPath, ...argv.slice(at)];
}

/* ---------------------------------------------------------------------- server */

export class HookBridge {
  private server: http.Server | null = null;
  private readonly token = crypto.randomBytes(24).toString("hex");
  private readonly always = new Set<string>();
  endpoint = "";
  install: HookInstall | null = null;

  constructor(private options: HookOptions) {}

  async start(dataDir: string): Promise<void> {
    this.install = installHookFiles(dataDir);
    installedSettingsPath = this.install.settingsPath;
    const server = http.createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    this.endpoint = `http://127.0.0.1:${address.port}`;
    environment = {
      VIVARIUM_HOOK_ENDPOINT: this.endpoint,
      VIVARIUM_HOOK_TOKEN: this.token,
      // For a CLI with its own hook format: point it at this program and the
      // event it pipes in is the same one the built-in integrations send.
      VIVARIUM_HOOK_SCRIPT: this.install.scriptPath,
    };
  }

  stop(): void {
    environment = {};
    installedSettingsPath = "";
    this.server?.close();
    this.server = null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || (url !== "/hook" && url !== "/pre-tool-use")) {
      res.writeHead(404).end("not found");
      return;
    }
    if (req.headers["x-vivarium-hook-token"] !== this.token) {
      res.writeHead(403).end("bad token");
      return;
    }

    const raw = await new Promise<string>((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY) reject(new Error("hook payload too large"));
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    }).catch(() => "");

    let event: {
      hook_event_name?: string;
      tool_name?: string;
      tool_input?: Record<string, unknown>;
      tool_use_id?: string;
      tool_response?: unknown;
      cwd?: string;
    } = {};
    try {
      event = JSON.parse(raw || "{}") as typeof event;
    } catch {
      event = {};
    }

    const tool = typeof event.tool_name === "string" ? event.tool_name : "";
    const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
    const danger = tool ? dangerOf(tool) : null;
    const eventName = typeof event.hook_event_name === "string" ? event.hook_event_name : "PreToolUse";
    const id = typeof event.tool_use_id === "string" ? event.tool_use_id : "";
    const subagent = SUBAGENT_TOOLS.has(tool.toLowerCase().replace(/[^a-z]/g, ""));

    // A subagent is not a tool to approve: it is a worker, and the window should
    // show it the way it shows a delegated one. PostToolUse closes the loop.
    if (subagent) {
      if (eventName === "PostToolUse") {
        const raw = event.tool_response;
        const text =
          typeof raw === "string" ? raw : JSON.stringify(raw ?? "", null, 2).slice(0, 4000);
        this.options.report?.({ id, text: text || "(no answer)", ok: true });
      } else {
        const field = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
        const name = field("subagent_type") || field("agent_type") || field("description") || "worker";
        const brief = field("description") || field("prompt").slice(0, 500);
        this.options.dispatch?.({ id, name, brief });
      }
      this.respond(res, "allow", "Vivarium is watching this worker.");
      return;
    }

    // Reads and tools we do not recognise go straight through.
    if (!tool || !danger) {
      this.respond(res, "allow", "Vivarium passes this call through.");
      return;
    }

    const key = `${danger}:${tool}`;
    if (this.always.has(key)) {
      this.respond(res, "allow", `Vivarium: ${tool} is always allowed for this session.`);
      return;
    }

    let decision: GateDecision = "deny";
    try {
      decision = await Promise.race([
        this.options.ask({ tool, args: input, danger, summary: summarise(tool, input) }),
        new Promise<GateDecision>((resolve) => setTimeout(() => resolve("deny"), DECISION_TIMEOUT_MS)),
      ]);
    } catch {
      decision = "deny";
    }

    if (decision === "always") this.always.add(key);
    if (decision === "deny") {
      this.respond(res, "deny", "Not now — the person declined this call in Vivarium.");
      return;
    }
    this.respond(res, "allow", "Approved in Vivarium.");
  }

  private respond(res: http.ServerResponse, decision: "allow" | "deny", reason: string): void {
    const body = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
      // Older Claude-Code-compatible releases read this pairing instead.
      decision: decision === "allow" ? "approve" : "block",
      reason,
    };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  }
}
