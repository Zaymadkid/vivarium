import type { ToolSchema } from "./providers";

/**
 * MCP over streamable HTTP, just enough for the browser that is already signed
 * in on this machine.
 *
 * BrowserOS neo serves its tools at a loopback port. The app holds one transport
 * session for its lifetime; if neo restarts, the stale-session response is
 * caught and the client re-initialises once before giving up. Nothing here
 * reaches beyond 127.0.0.1 unless the person points VIV_NEO_URL somewhere else.
 */

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const DEFAULT_URL = "http://127.0.0.1:9210/mcp";

export class McpClient {
  private nextId = 1;
  private session: string | null = null;
  private initialized = false;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly url = process.env.VIV_NEO_URL ?? DEFAULT_URL,
    private readonly clientName = "vivarium",
  ) {}

  get endpoint() {
    return this.url;
  }

  private headers() {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.session) headers["mcp-session-id"] = this.session;
    return headers;
  }

  private async request(method: string, params: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `${this.clientName}: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
    const frames = this.frames(body);
    const answer =
      frames.find((f) => f.id === id) ??
      frames.find((f) => f.result !== undefined || f.error !== undefined);
    if (!answer) {
      throw new Error(`${this.clientName} returned no answer for ${method}.`);
    }
    if (answer.error) throw new Error(answer.error.message ?? `${method} failed.`);
    return answer.result;
  }

  /** Both a plain JSON body and an SSE frame are valid MCP responses. */
  private frames(body: string): RpcResponse[] {
    const text = body.trim();
    if (!text) return [];
    if (text.startsWith("{")) {
      try {
        return [JSON.parse(text) as RpcResponse];
      } catch {
        return [];
      }
    }
    const out: RpcResponse[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        out.push(JSON.parse(payload) as RpcResponse);
      } catch {
        // a partial frame is not an answer
      }
    }
    return out;
  }

  private async start() {
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: this.clientName, version: "1.0.0" },
      },
      9000,
    )) as unknown;
    if (!result) throw new Error(`${this.clientName} did not finish initialising.`);
    // The notification has no id and no response worth reading.
    await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined);
    this.initialized = true;
  }

  private async ensure() {
    if (this.initialized) return;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  private reset() {
    this.initialized = false;
    this.session = null;
  }

  private async withSession<T>(work: () => Promise<T>): Promise<T> {
    await this.ensure();
    try {
      return await work();
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      // Only a dead transport session is retried. A tool's own "element not
      // found" is an answer, and repeating a click could double an action.
      if (/session (?:not found|expired|invalid)|invalid mcp-session|mcp-session-id/i.test(message)) {
        this.reset();
        await this.ensure();
        return work();
      }
      throw err;
    }
  }

  async available(): Promise<boolean> {
    try {
      await this.withSession(async () => {
        await this.request("tools/list", {}, 2500);
      });
      return true;
    } catch {
      this.reset();
      return false;
    }
  }

  async listTools(): Promise<ToolSchema[]> {
    return this.withSession(async () => {
      const result = (await this.request("tools/list", {})) as {
        tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      };
      return (result.tools ?? []).map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description ?? t.name,
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        },
      }));
    });
  }

  async call(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<string> {
    return this.withSession(async () => {
      const result = (await this.request("tools/call", { name, arguments: args }, timeoutMs)) as {
        content?: { type?: string; text?: string; data?: string; mimeType?: string }[];
        isError?: boolean;
        structuredContent?: unknown;
      };
      const parts = (result.content ?? []).map((c) => {
        if (c.type === "text") return c.text ?? "";
        if (c.type === "image") return `[image ${c.mimeType ?? "image"}]`;
        return c.text ?? JSON.stringify(c);
      });
      const text =
        parts.filter(Boolean).join("\n").trim() ||
        (result.structuredContent ? JSON.stringify(result.structuredContent) : "");
      if (result.isError) throw new Error(text || `${name} failed in the browser.`);
      return text;
    });
  }
}

/** One client for the whole app: neo keys tab ownership to its connection. */
export const neo = new McpClient();
