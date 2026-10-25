import { spawn } from "node:child_process";
import type { ProviderId } from "../shared/types";
import { PROVIDER_CATALOG, providerInfo } from "../shared/providers";
import { cliBridgeArgs } from "./cli-bridge";
import { cliHookSettings, decorateCliArgs, hookEnvironment } from "./hookbridge";

/**
 * Provider plugins.
 *
 * A provider is four things: an id, a label, a way to list models, and a way to
 * stream one turn. `cancel(runId)` is part of the contract because the runtime
 * registers a run before the first byte and must be able to stop it mid-stream.
 *
 * Adding a provider is: write a class, call `registerProvider()` at the bottom of
 * this file. The settings UI renders `PROVIDER_CATALOG`, so nothing in the
 * renderer needs to change — the catalogue entry is presentation only.
 *
 * Implementations here are deliberately small:
 *   mock                — deterministic, offline, no keys, tool-capable
 *   openai-compatible   — any /v1/chat/completions endpoint
 *   ollama              — native /api/chat NDJSON
 *   cli                 — any CLI agent, prompt on argv or stdin
 */

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: WireToolCall[];
  /** Base64 JPEGs. Used by the screen tool; providers that cannot see drop them. */
  images?: string[];
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  cliCommand: string;
  model: string;
}

export interface ProviderContext extends ProviderConfig {
  /** Stable per run; used as the cancel key and in logs. */
  runId: string;
  messages: WireMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
}

export type ProviderEvent =
  | { type: "text"; text: string }
  /**
   * Throw away the text streamed so far for this turn and start again. A CLI
   * agent runs its own tool hops: the words before a tool call are a preamble,
   * not the answer, and appending them to the final message reads like a stutter.
   */
  | { type: "reset" }
  | { type: "tool_call"; calls: WireToolCall[] }
  | { type: "usage"; inputChars: number; outputChars: number }
  | { type: "error"; message: string };

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  listModels(config: ProviderConfig): Promise<string[]>;
  /** Streams one assistant turn. May yield text, then tool calls, in that order. */
  chat(ctx: ProviderContext): AsyncGenerator<ProviderEvent>;
  /** Abort an in-flight run started with this provider. Safe to call twice. */
  cancel(runId: string): void;
}

const abortError = () => new DOMException("Aborted", "AbortError");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Shared bookkeeping so every provider gets cancellation for free. */
abstract class BaseProvider implements Provider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;

  private controllers = new Map<string, AbortController>();

  protected abstract stream(ctx: ProviderContext): AsyncGenerator<ProviderEvent>;
  protected fallbackModels: string[] = ["default"];

  async listModels(config: ProviderConfig): Promise<string[]> {
    if (!config.baseUrl) return this.fallbackModels;
    return this.fallbackModels;
  }

  cancel(runId: string) {
    const controller = this.controllers.get(runId);
    if (!controller) return;
    controller.abort();
    this.controllers.delete(runId);
  }

  async *chat(ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
    const local = new AbortController();
    const forward = () => local.abort();
    if (ctx.signal.aborted) local.abort();
    ctx.signal.addEventListener("abort", forward, { once: true });
    this.controllers.set(ctx.runId, local);

    let outputChars = 0;
    let inputChars = 0;
    try {
      for await (const event of this.stream({ ...ctx, signal: local.signal })) {
        if (event.type === "text") outputChars += event.text.length;
        yield event;
      }
    } finally {
      ctx.signal.removeEventListener("abort", forward);
      this.controllers.delete(ctx.runId);
      inputChars = ctx.messages.reduce((n, m) => n + m.content.length, 0);
      yield { type: "usage", inputChars, outputChars };
    }
  }
}

/* ------------------------------------------------------------------------- mock */

/**
 * Offline provider. Deterministic in three ways: same prompt → same words, same
 * tool decision, same delays (no randomness). It reads the last message to stay
 * useful inside the real loop: after a tool result it summarises instead of
 * calling the tool again.
 */
class MockProvider extends BaseProvider {
  readonly id = "mock" as const;
  readonly label = "Mock (offline)";
  protected fallbackModels = ["vivarium-mock-1"];

  private decisions = new Map<string, number>();

  private toolHint(text: string): { name: string; args: Record<string, unknown> } | null {
    const clean = text.trim();
    if (/\blist\s+(?:the\s+)?(?:browser\s+)?tabs\b/i.test(clean)) {
      return { name: "browser_tabs", args: { action: "list" } };
    }
    const list = clean.match(/^(?:please\s+)?(?:list|ls)\s+(?:the\s+)?(?:folder\s+|directory\s+|files\s+in\s+)?(.+)$/i);
    if (list) return { name: "list_files", args: { path: list[1].trim().replace(/^["']|["']$/g, "") } };
    const read = clean.match(/^(?:please\s+)?(?:read|open|show)\s+(?:the\s+file\s+)?(.+)$/i);
    if (read) {
      const path = read[1].trim().replace(/^["']|["']$/g, "");
      if (path.includes(".") || path.includes("/") || path.includes("\\")) {
        return { name: "read_file", args: { path } };
      }
    }
    const remember = clean.match(/^(?:please\s+)?(?:remember|note)\s+(?:that\s+)?(.+)$/i);
    if (remember) return { name: "remember", args: { text: remember[1].trim() } };
    // The offline demo can still show the two capabilities that are easy to
    // doubt: the screen she is allowed to look at, and the signed-in browser.
    if (/(?:look at|see|check|read) (?:my |the )?screen|what(?:'s| is) on my screen/i.test(clean)) {
      return { name: "see_screen", args: { reason: "asked to look at the screen" } };
    }
    const browse = clean.match(/\bopen\s+(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)\s+in\s+(?:the\s+)?browser/i);
    if (browse) {
      const url = /^https?:\/\//i.test(browse[1]) ? browse[1] : `https://${browse[1]}`;
      return { name: "browser_open", args: { url } };
    }
    return null;
  }

  protected async *stream(ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
    const last = [...ctx.messages].reverse().find((m) => m.role === "user");
    const lastIsTool = ctx.messages[ctx.messages.length - 1]?.role === "tool";
    const prompt = last?.content ?? "";
    const seen = this.decisions.get(ctx.runId) ?? 0;

    if (!lastIsTool && seen === 0 && ctx.tools.length > 0) {
      const hint = this.toolHint(prompt);
      if (hint && ctx.tools.some((t) => t.function.name === hint.name)) {
        this.decisions.set(ctx.runId, seen + 1);
        // Deterministic preamble so the approval card has context.
        for (const word of `I will ${hint.name.replace(/_/g, " ")} first.`.split(/(\s+)/)) {
          if (ctx.signal.aborted) throw abortError();
          await sleep(8);
          yield { type: "text", text: word };
        }
        yield {
          type: "tool_call",
          calls: [
            {
              id: `mock-${ctx.runId}-${seen}`,
              type: "function",
              function: { name: hint.name, arguments: JSON.stringify(hint.args) },
            },
          ],
        };
        return;
      }
    }

    const lines = lastIsTool
      ? [
          "The tool came back.",
          "",
          "I stayed inside the folders you allowed and every write was approved first.",
          "Ask me for something else, or point the runtime at a real provider in Settings.",
        ]
      : [
          "This is the offline mock provider, so nothing left this machine.",
          "",
          prompt ? `You said: "${prompt.slice(0, 240)}"` : "You did not say anything yet.",
          "",
          "The same loop runs against any provider: stream, tool call, approval, result, teardown.",
          "Try “list files in <folder>” or “remember that the accent is ember” to see it work.",
        ];

    for (const chunk of lines) {
      for (const token of chunk.split(/(\s+)/)) {
        if (!token) continue;
        if (ctx.signal.aborted) throw abortError();
        await sleep(token.trim() ? 10 : 4);
        yield { type: "text", text: token };
      }
      yield { type: "text", text: "\n" };
    }
  }
}

/* ------------------------------------------------------- openai-compatible http */

async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

class OpenAiCompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly label: string;
  protected fallbackModels: string[];

  constructor(id: ProviderId, label: string, models: string[]) {
    super();
    this.id = id;
    this.label = label;
    this.fallbackModels = models;
  }

  override async listModels(config: ProviderConfig): Promise<string[]> {
    const base = config.baseUrl.replace(/\/$/, "");
    if (!base) return this.fallbackModels;
    try {
      const res = await fetch(`${base}/models`, {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return this.fallbackModels;
      const body = (await res.json()) as { data?: { id?: string }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      return ids.length ? ids.slice(0, 200) : this.fallbackModels;
    } catch {
      return this.fallbackModels;
    }
  }

  protected async *stream(ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
    // A message with images becomes a content array, the only shape OpenAI's
    // chat endpoint accepts an image in. Text-only turns keep the plain string.
    const messages = ctx.messages.map((m) => {
      if (!m.images?.length) return m;
      return {
        ...m,
        content: [
          { type: "text", text: m.content || "Attached image." },
          ...m.images.map((b64) => ({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${b64}` },
          })),
        ],
      };
    });
    const res = await fetch(`${ctx.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "content-type": "application/json",
        ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: true,
        messages,
        ...(ctx.tools.length ? { tools: ctx.tools, tool_choice: "auto" } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 400)}` : ""}`,
      };
      return;
    }

    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const line of readLines(res)) {
      if (ctx.signal.aborted) throw abortError();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = calls.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        calls.set(tc.index, slot);
      }
    }

    const finished = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c], i) => ({
        id: c.id || `call_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      }))
      .filter((c) => c.function.name);
    if (finished.length) yield { type: "tool_call", calls: finished };
  }
}

/* ----------------------------------------------------------------------- ollama */

class OllamaProvider extends BaseProvider {
  readonly id = "ollama" as const;
  readonly label = "Ollama (local)";
  protected fallbackModels = ["llama3.2", "qwen2.5", "mistral"];

  override async listModels(config: ProviderConfig): Promise<string[]> {
    const base = (config.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return this.fallbackModels;
      const body = (await res.json()) as { models?: { name?: string }[] };
      const names = (body.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
      return names.length ? names : this.fallbackModels;
    } catch {
      return this.fallbackModels;
    }
  }

  protected async *stream(ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
    const base = ctx.baseUrl.includes("11434") ? ctx.baseUrl : "http://127.0.0.1:11434";
    const res = await fetch(`${base.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: ctx.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: ctx.model,
        stream: true,
        messages: ctx.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: m.images } : {}),
        })),
      }),
    });
    if (!res.ok) {
      yield { type: "error", message: `Ollama ${res.status}: ${await res.text().catch(() => "")}` };
      return;
    }
    for await (const line of readLines(res)) {
      if (ctx.signal.aborted) throw abortError();
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        const text = chunk?.message?.content;
        if (typeof text === "string" && text) yield { type: "text", text };
        if (chunk?.done) break;
      } catch {
        // partial NDJSON line; the next read completes it
      }
    }
  }
}

/* -------------------------------------------------------------------------- cli */

const CLI_TEMPLATES: Record<string, string> = {
  opencode: "opencode run {prompt}",
  codebuddy: "codebuddy --setting-sources project,local --model {model} --output-format stream-json --include-partial-messages -p {prompt}",
  claude: "claude -p {prompt}",
  codex: "codex exec {prompt}",
  gemini: "gemini -p {prompt}",
};

class CliProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly label: string;
  protected fallbackModels = ["default"];

  constructor(id: ProviderId, label: string) {
    super();
    this.id = id;
    this.label = label;
  }

  protected async *stream(ctx: ProviderContext): AsyncGenerator<ProviderEvent> {
    const template = (ctx.cliCommand || CLI_TEMPLATES[this.id] || "").trim();
    if (!template) {
      yield { type: "error", message: "No command configured for this provider." };
      return;
    }
    // A CLI has no wire protocol to carry the app's context, so the system
    // prompt travels first — otherwise the CLI answers as itself ("a coding
    // agent in this workspace") instead of as the companion whose window it is.
    // Recent turns follow, or every message would be a fresh session.
    const system = ctx.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const recent = ctx.messages.filter((m) => m.role !== "system").slice(-6);
    const prompt =
      [
        system,
        recent
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(-16000) || "";
    const parts = template.split(/\s+/);
    const usesPrompt = parts.some((p) => p === "{prompt}");
    const model = ctx.model && ctx.model !== "default" ? ctx.model : "";
    let argv = parts.map((p) => (p === "{prompt}" ? prompt : p === "{model}" ? model : p));
    if (!model) {
      // Do not leave a dangling `--model` when the provider has no model set.
      const flag = argv.lastIndexOf("--model");
      if (flag >= 0) argv.splice(flag, 2);
    }
    if (this.id === "codebuddy") {
      // Everything after -p is prompt text, so the browser bridge has to land
      // before it. A person who already passed their own config keeps it.
      const bridge = cliBridgeArgs();
      const at = argv.lastIndexOf("-p");
      if (bridge.length && at >= 0 && !argv.includes("--mcp-config")) {
        argv = [...argv.slice(0, at), ...bridge, ...argv.slice(at)];
      }
    }
    if (!usesPrompt) {
      // `template` has no placeholder, so the prompt goes on stdin
    }
    // Every CLI inherits the approval hook's address. Claude-Code-compatible
    // ones (CodeBuddy, claude) also get the hook installed via `--settings`, so
    // their shell and file tools raise a card here instead of running unattended.
    const [cmd, ...args] = decorateCliArgs(argv, cliHookSettings());
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...hookEnvironment() },
    });
    const onAbort = () => child.kill();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    if (usesPrompt) child.stdin.end();
    else child.stdin.end(prompt);

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));

    const queue: string[] = [];
    let ended = false;
    let wake: (() => void) | null = null;
    const bump = () => {
      wake?.();
      wake = null;
    };

    // CodeBuddy (and Claude Code) can emit one JSON event per line with
    // `--output-format stream-json`. Chat wants the words as they arrive, not
    // the envelope, and not a twenty-second wait for the whole answer.
    const streamJson = /--output-format(=|\s)stream-json/.test(template);
    let carry = "";
    let sawText = false;
    const take = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          event?: { type?: string; delta?: { type?: string; text?: string } };
          result?: unknown;
        };
        if (event.type === "stream_event" && event.event?.type === "message_start") {
          // A second assistant message in one CLI invocation is the next hop of
          // the CLI's own agent loop. Its preamble is not part of the answer.
          if (sawText) {
            queue.push("\u0001");
            sawText = false;
          }
          return;
        }
        if (event.type === "stream_event") {
          const delta = event.event?.delta;
          if (event.event?.type === "content_block_delta" && delta?.type === "text_delta" && delta.text) {
            sawText = true;
            queue.push(delta.text);
          }
          return;
        }
        if (event.type === "result" && !sawText && typeof event.result === "string") {
          sawText = true;
          queue.push(event.result);
        }
      } catch {
        // A malformed line is dropped; the next chunk starts clean.
      }
    };

    child.stdout.on("data", (d) => {
      const chunk = String(d);
      if (!streamJson) {
        queue.push(chunk);
        bump();
        return;
      }
      carry += chunk;
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) take(line);
      bump();
    });
    child.on("error", (err) => {
      queue.push(`\u0000${err.message}`);
      ended = true;
      bump();
    });
    child.on("close", () => {
      if (streamJson && carry.trim()) take(carry);
      ended = true;
      bump();
    });

    try {
      while (true) {
        if (queue.length) {
          const next = queue.shift()!;
          if (next.startsWith("\u0000")) {
            yield { type: "error", message: next.slice(1) };
            return;
          }
          if (next === "\u0001") {
            yield { type: "reset" };
            continue;
          }
          yield { type: "text", text: next };
          continue;
        }
        if (ended) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 250);
        });
      }
      if (stderr.trim() && !ctx.signal.aborted) {
        console.info(`[${this.id}] stderr: ${stderr.slice(0, 500)}`);
      }
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill();
    }
  }
}

/* --------------------------------------------------------------------- registry */

const registry = new Map<ProviderId, Provider>();

/** Register (or replace) one provider plugin. Called once per implementation. */
export function registerProvider(provider: Provider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: ProviderId): Provider {
  const found = registry.get(id);
  if (found) return found;
  // A catalogue entry without an implementation should not crash a turn; the
  // mock provider answers with an explanation instead.
  const mock = registry.get("mock");
  if (!mock) throw new Error(`No provider registered for "${id}" and no mock fallback.`);
  return mock;
}

export function listProviders(): Provider[] {
  return [...registry.values()];
}

const mock = new MockProvider();
registerProvider(mock);

registerProvider(
  new OpenAiCompatibleProvider(
    "openai",
    providerInfo("openai").label,
    providerInfo("openai").models ?? PROVIDER_CATALOG[1].models ?? ["gpt-4o-mini"],
  ),
);
registerProvider(new OllamaProvider());

for (const id of ["opencode", "codebuddy", "claude", "codex", "gemini", "custom-cli"] as const) {
  registerProvider(new CliProvider(id, providerInfo(id).label));
}
