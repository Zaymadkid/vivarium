import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { captureScreen } from "./screen";
import { hideGuide, showGuide } from "./guide";
import { clickAt, describeProbe, handsReady, pressKeys, probeWindow, scroll, typeText } from "./hands";
import { describeSchedule } from "../shared/schedule";
import type { RoutineSchedule } from "../shared/types";
import type { Store } from "./store";
import type { Vault } from "./vault";

/**
 * THE APP'S OWN TOOLS, FOR A CLI MIND.
 *
 * CodeBuddy brings its own shell and files, but it cannot draw the pointer, read
 * the recall vault or speak with the app's memory. This starts a token-guarded
 * loopback endpoint and writes a small stdio MCP server that the CLI launches;
 * every call lands in the same store, vault and guide the rest of the app uses.
 *
 * The token lives in the user's data folder, the listener is bound to 127.0.0.1,
 * and non-loopback peers are refused. Nothing here is reachable from a browser:
 * there is no CORS grant and no GET tool route.
 */

export interface AppBridge {
  url: string;
  token: string;
  scriptPath: string;
  tools: typeof TOOLS;
}

const TOOLS = [
  {
    name: "see_screen",
    description:
      "Take a still of this computer's primary display and get its path. Read the path with ViewImage before saying anything about the screen. Requires Screen access in the app's Settings → Machine access.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "guide_screen",
    description:
      "Draw a click-through guide over the person's real screen: a spotlight and pointer around one control per step, with a short line beside it. Coordinates are fractions of the screen (0–1, origin top-left), estimated from a see_screen image. Advance with Ctrl+Alt+Right, back with Ctrl+Alt+Left, dismiss with Escape. Pass an empty steps list to clear it. Never point at a password, card or ID field.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The task being walked through." },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One imperative sentence, at most 12 words." },
              title: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              label: { type: "string" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  {
    name: "vault_search",
    description:
      "Search the person's local document vault and return cited passages. Cite answers as [document, passage n].",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "vault_add",
    description: "Save a long note or excerpt into the local vault so it can be searched and cited later.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "desktop_look",
    description:
      "Read a window's controls on this computer with UI Automation: title, screen size, and named controls with pixel boxes. Use before clicking. Requires Control this computer in the app's Settings → Machine access.",
    inputSchema: {
      type: "object",
      properties: { window: { type: "string", description: "Part of a window title; omit for the front window." } },
      additionalProperties: false,
    },
  },
  {
    name: "desktop_click",
    description:
      "Move the visible pointer and left-click a pixel from desktop_look. Every click asks the person first. Never click purchase, send or delete controls unless explicitly asked.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        window: { type: "string" },
        label: { type: "string" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: "desktop_type",
    description: "Type text into the focused field of the last window looked at, optionally pressing Enter. Every use asks the person first.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        submit: { type: "boolean" },
        window: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "desktop_key",
    description: "Press a key or shortcut (ENTER, CTRL+S, ALT+TAB) in the last window looked at. Every use asks the person first.",
    inputSchema: {
      type: "object",
      properties: { keys: { type: "string" }, window: { type: "string" } },
      required: ["keys"],
      additionalProperties: false,
    },
  },
  {
    name: "desktop_scroll",
    description: "Scroll the last window looked at; positive is up, negative down.",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number" }, x: { type: "number" }, y: { type: "number" } },
      required: ["amount"],
      additionalProperties: false,
    },
  },
  {
    name: "read_pack",
    description: "Read the attached context pack, or a named one. The attached pack is already in your system prompt.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "remember",
    description:
      "Keep one durable fact about the person: a name, preference, project, person or correction. Call it again with the corrected version when a fact changes — the old near-duplicate is replaced, not duplicated.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "create_skill",
    description:
      "Write down a procedure that actually worked, so future turns follow it instead of rediscovering it. Reuse the same name to improve one skill rather than adding near-duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        instructions: { type: "string" },
      },
      required: ["name", "instructions"],
      additionalProperties: false,
    },
  },
  {
    name: "set_reminder",
    description:
      "Schedule something for later: a notification (kind=reminder) or a prompt run in the chat (kind=routine). Survives restarts; the app must be running when it is due.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["reminder", "routine"] },
        text: { type: "string" },
        when: { type: "string", enum: ["once", "daily", "weekdays", "weekly"] },
        time: { type: "string", description: "HH:MM local, for daily/weekdays/weekly." },
        at: { type: "string", description: "ISO datetime, for once." },
        weekday: { type: "number", description: "0=Sunday … 6=Saturday." },
      },
      required: ["name", "text", "when"],
      additionalProperties: false,
    },
  },
  {
    name: "list_reminders",
    description: "List reminders and routines with their next time, so you can check before scheduling a duplicate.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const SERVER_SCRIPT = String.raw`#!/usr/bin/env node
// Minimal MCP stdio server for Vivarium's own tools. It holds no state: every
// call is forwarded to the running app on loopback, with a bearer token passed
// in the environment by the config the app wrote.
import readline from "node:readline";

const url = process.env.VIV_MCP_URL;
const token = process.env.VIV_MCP_TOKEN;
const TOOLS = __TOOLS__;

const reply = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vivarium", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized" || msg.id === undefined) return;
  if (msg.method === "tools/list") {
    reply({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === "ping") {
    reply({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "tools/call") {
    try {
      const res = await fetch(url + "/tool", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ name: msg.params?.name, args: msg.params?.arguments || {} }),
      });
      const data = await res.json();
      reply({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: String(data.text || data.error || "No answer.") }],
          isError: Boolean(data.error),
        },
      });
    } catch (err) {
      reply({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "Vivarium is not answering: " + String(err && err.message ? err.message : err) }],
          isError: true,
        },
      });
    }
    return;
  }
  reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
});
`;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function loopback(req: http.IncomingMessage) {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export type BridgeApproval = (tool: string, args: Record<string, unknown>) => Promise<boolean>;

export async function startAppBridge(store: Store, vault: Vault, ask?: BridgeApproval): Promise<AppBridge> {
  const token = crypto.randomBytes(24).toString("hex");
  const directory = path.join(store.dir, "mcp");
  fs.mkdirSync(directory, { recursive: true });
  const scriptPath = path.join(directory, "vivarium-tools.mjs");
  fs.writeFileSync(scriptPath, SERVER_SCRIPT.replace("__TOOLS__", JSON.stringify(TOOLS)), "utf8");

  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const settings = store.getSettings();
    if ((name === "see_screen" || name === "guide_screen") && !settings.abilities?.screen) {
      throw new Error("Screen access is off. Turn it on in Vivarium → Settings → Machine access.");
    }
    if (name.startsWith("desktop_") && !settings.abilities?.hands) {
      throw new Error("Control this computer is off. Turn it on in Vivarium → Settings → Machine access.");
    }
    // A CLI turn has no approval loop of its own; the card is raised through the
    // same pending stack the app's tools use, and a denial stops here.
    if (
      ask &&
      (name === "desktop_click" ||
        name === "desktop_type" ||
        name === "desktop_key" ||
        name === "desktop_scroll" ||
        name === "set_reminder")
    ) {
      const allowed = await ask(name, args);
      if (!allowed) throw new Error("The person denied that action.");
    }
    switch (name) {
      case "see_screen": {
        const shot = await captureScreen(store.dir);
        return [
          `Captured the primary display (${shot.width}×${shot.height}) at ${shot.path}.`,
          "Read that file with ViewImage before describing anything in it.",
        ].join("\n");
      }
      case "guide_screen": {
        const steps = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : [];
        if (steps.length === 0) {
          hideGuide();
          return "Guide cleared.";
        }
        const state = showGuide({
          goal: typeof args.goal === "string" ? args.goal : "",
          steps: steps.slice(0, 12).map((step) => ({
            text: String(step.text ?? ""),
            title: step.title ? String(step.title) : undefined,
            x: typeof step.x === "number" ? step.x : undefined,
            y: typeof step.y === "number" ? step.y : undefined,
            width: typeof step.width === "number" ? step.width : undefined,
            height: typeof step.height === "number" ? step.height : undefined,
            label: step.label ? String(step.label) : undefined,
          })),
        });
        return state.active
          ? `Showing step 1 of ${state.steps.length}. Ctrl+Alt+Right advances, Escape clears. It is click-through, so the app underneath still works.`
          : "No usable steps were given, so nothing was drawn.";
      }
      case "vault_search": {
        const hits = vault.search(String(args.query ?? ""), 6);
        if (hits.length === 0) return "Nothing in the vault matches that.";
        return hits
          .map(
            (hit, i) =>
              `${i + 1}. “${hit.title}”, passage ${hit.chunk} (score ${hit.score})\n${hit.text}\nCite as [${hit.title}, passage ${hit.chunk}].`,
          )
          .join("\n\n");
      }
      case "vault_add": {
        const doc = vault.add({
          title: typeof args.title === "string" ? args.title : undefined,
          body: String(args.body ?? ""),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        });
        return `Added “${doc.title}” to the vault (${doc.chunks} passages).`;
      }
      case "desktop_look": {
        if (!handsReady()) throw new Error("Hands are only available on Windows.");
        return describeProbe(await probeWindow(typeof args.window === "string" ? args.window : undefined));
      }

      case "desktop_click": {
        const result = await clickAt(Number(args.x), Number(args.y), {
          title: typeof args.window === "string" ? args.window : undefined,
          label: typeof args.label === "string" ? args.label : undefined,
        });
        return `Clicked at ${result.x},${result.y} in “${result.probe.window.title}”.`;
      }
      case "desktop_type": {
        const probe = await typeText(
          String(args.text ?? ""),
          args.submit === true,
          typeof args.window === "string" ? args.window : undefined,
        );
        return `Typed into “${probe.window.title}”.`;
      }
      case "desktop_key": {
        const probe = await pressKeys(String(args.keys ?? ""), typeof args.window === "string" ? args.window : undefined);
        return `Pressed ${String(args.keys ?? "")} in “${probe.window.title}”.`;
      }
      case "desktop_scroll": {
        const probe = await scroll(Number(args.amount), Number.isFinite(Number(args.x)) ? Number(args.x) : undefined, Number.isFinite(Number(args.y)) ? Number(args.y) : undefined);
        return `Scrolled ${Number(args.amount)} in “${probe.window.title}”.`;
      }
      case "read_pack": {
        const wanted = String(args.name ?? "").trim().toLowerCase();
        const packs = store.listPacks();
        const pack = wanted
          ? packs.find((p) => p.name.toLowerCase() === wanted || p.id === wanted)
          : store.getAttachedPack() ?? packs[0];
        if (!pack) {
          return packs.length
            ? `No pack is attached. Available: ${packs.map((p) => p.name).join(", ")}.`
            : "No context packs exist yet. Documents → Packs creates them.";
        }
        return [`# ${pack.name}`, pack.description, pack.body.slice(0, 40_000)].filter(Boolean).join("\n\n");
      }
      case "remember": {
        const text = String(args.text ?? "").trim();
        if (!text) throw new Error("A memory needs some text.");
        const result = store.learnFact(text);
        return result?.added
          ? `Kept: ${text}`
          : `Already known, or too close to an existing fact: ${text}`;
      }
      case "create_skill": {
        const name = String(args.name ?? "").trim();
        if (!name) throw new Error("A skill needs a name.");
        const skill = store.saveSkill({
          name,
          description: String(args.description ?? ""),
          instructions: String(args.instructions ?? ""),
          source: "learned",
        });
        return `Skill “${skill.name}” saved. It is in the next turn's prompt.`;
      }
      case "set_reminder": {
        const name = String(args.name ?? "").trim() || String(args.text ?? "").slice(0, 40);
        const text = String(args.text ?? "").trim();
        const when = String(args.when ?? "once");
        if (!name || !text) throw new Error("A reminder needs a name and some text.");
        let schedule: RoutineSchedule;
        if (when === "once") {
          const at = Date.parse(String(args.at ?? ""));
          if (!Number.isFinite(at)) throw new Error("For a one-off, pass `at` as an ISO datetime.");
          schedule = { kind: "once", at };
        } else {
          const time = /^\d{1,2}:\d{2}$/.test(String(args.time ?? "")) ? String(args.time) : "09:00";
          if (when === "weekly") {
            schedule = {
              kind: "weekly",
              weekday: Math.min(6, Math.max(0, Number(args.weekday) || 1)),
              time,
            };
          } else if (when === "weekdays") {
            schedule = { kind: "weekdays", time };
          } else {
            schedule = { kind: "daily", time };
          }
        }
        const saved = store.saveRoutine({
          name,
          prompt: text,
          kind: String(args.kind ?? "") === "routine" ? "routine" : "reminder",
          schedule,
        });
        return `Scheduled “${saved.name}” — ${describeSchedule(saved.schedule)}.`;
      }
      case "list_reminders": {
        const rows = store.listRoutines();
        if (rows.length === 0) return "Nothing is scheduled.";
        return rows
          .map(
            (r) =>
              `${r.enabled ? "on" : "off"} · ${r.name} · ${describeSchedule(r.schedule)} · next ${new Date(r.nextAt).toLocaleString()}`,
          )
          .join("\n");
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  const server = http.createServer(async (req, res) => {
    if (!loopback(req)) {
      res.writeHead(403).end("loopback only");
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/tool") {
      res.writeHead(404).end("not found");
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    try {
      const body = JSON.parse(await readBody(req)) as { name?: string; args?: Record<string, unknown> };
      const text = await call(String(body.name ?? ""), body.args ?? {});
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text }));
    } catch (err) {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, token, scriptPath, tools: TOOLS };
}
