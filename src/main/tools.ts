import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Notification, shell } from "electron";
import type { ApprovalPolicy, Danger, RoutineSchedule } from "../shared/types";
import { describeSchedule } from "../shared/schedule";
import type { ToolSchema } from "./providers";
import { neo } from "./mcp";
import { captureScreen } from "./screen";
import { hideGuide, showGuide } from "./guide";
import { clickAt, describeProbe, handsReady, pressKeys, probeWindow, scroll, typeText } from "./hands";
import type { Vault } from "./vault";
import type { Store } from "./store";

/**
 * The tool registry.
 *
 * One entry per capability the runtime can hand an agent. The registry is both
 * the source of the JSON schema the model sees and the place the approval
 * policy lives, so a tool cannot be described without saying how much consent
 * it needs.
 *
 * `source` says where a tool came from: `core` for a verb this app ships with,
 * `ours` for a local-first addition, and `unverified` for a call that is known
 * but not exercised yet. `store` names where the tool's data lives. Keep both
 * accurate: the approval policy and the ledger read them.
 */

export interface ToolContext {
  store: Store;
  roots: string[];
  agentId: string;
  runId: string;
  signal: AbortSignal;
  /**
   * Supplied by the agent runtime. Spawns a child run on another agent and
   * resolves with its final answer. Kept out of the registry so the registry
   * has no dependency on the runtime.
   */
  delegate?: (target: string, brief: string) => Promise<string>;
  /** A tool that saw something collects the JPEG here; the runtime attaches it. */
  pendingImages?: string[];
  /** The local document index, so a tool can cite what the person gave her. */
  vault?: Vault;
}

export interface ToolDef {
  id: string;
  label: string;
  description: string;
  danger: Danger;
  approval: ApprovalPolicy;
  /**
   * Settings → Preferences → Without asking first. A tool belongs to exactly
   * one bucket so the three switches there mean something concrete:
   *   everyday — search, read, write documents, remember, fetch, delegate
   *   build    — create files and run commands
   *   destroy  — things that leave the app: sending, deleting, opening
   */
  category: "everyday" | "build" | "destroy";
  source: "core" | "ours" | "unverified";
  /** Plain JSON schema properties; wrapped into a function schema below. */
  input: Record<string, unknown>;
  required: string[];
  output: string;
  sideEffects: string[];
  /** Name of the store this tool writes to, or `—`. */
  store: string;
  invokes: string[];
  emits: string[];
  listens: string[];
  calls: string[];
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function inside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a path and prove it is inside an allowed root *after* symlink
 * resolution. The write path resolves the parent when the file does not exist
 * yet, so a symlinked parent cannot be used to escape.
 */
function resolveSafe(input: string, roots: string[]): string {
  if (roots.length === 0) {
    throw new Error(
      "No folders are allowed yet. Open Settings → Machine access and add the folder you want me to work in. I cannot read anything outside the folders you allow.",
    );
  }
  const raw = path.resolve(input);
  let real = raw;
  try {
    real = fs.realpathSync.native(raw);
  } catch {
    try {
      real = path.join(fs.realpathSync.native(path.dirname(raw)), path.basename(raw));
    } catch {
      real = raw;
    }
  }
  const ok = roots.some((r) => inside(path.resolve(r), real));
  if (!ok) {
    throw new Error(
      `That path is outside the folders you allowed (${roots.join(", ")}). Add it in Settings → Machine access first.`,
    );
  }
  return real;
}

function clamp(text: string, max = 20_000) {
  return text.length > max ? text.slice(0, max) + `\n… truncated ${text.length - max} chars` : text;
}

/**
 * Reads normally stay inside the folders the person granted. Settings →
 * Companion → Abilities can widen that to any path this user can open; the tool layer is
 * where that switch has to land, because a model cannot be trusted to obey a
 * paragraph of prompt.
 */
function resolveRead(input: string, ctx: ToolContext): string {
  if (ctx.store.getSettings().abilities?.readOutside) return path.resolve(input);
  return resolveSafe(input, ctx.roots);
}

function schema(tool: ToolDef): ToolSchema {
  return {
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.input,
        required: tool.required,
        additionalProperties: false,
      },
    },
  };
}

export const TOOLS: ToolDef[] = [
  {
    id: "list_files",
    label: "List files",
    description: "List the entries of a directory inside an allowed folder.",
    danger: "read",
    approval: "never",
    category: "everyday",
    source: "core",
    input: {
      path: { type: "string", description: "Absolute path, or a path relative to an allowed folder." },
    },
    required: ["path"],
    output: "Newline-separated `dir|file  name` rows, capped at 300 entries.",
    sideEffects: ["reads the filesystem inside an allowed root"],
    store: "—",
    invokes: ["local_read_dir"],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const dir = resolveRead(str(args.path) || ctx.roots[0] || process.cwd(), ctx);
      const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 300);
      return entries.map((e) => `${e.isDirectory() ? "dir " : "file"}  ${e.name}`).join("\n");
    },
  },
  {
    id: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file inside an allowed folder.",
    danger: "read",
    approval: "never",
    category: "everyday",
    source: "core",
    input: { path: { type: "string", description: "File path inside an allowed folder." } },
    required: ["path"],
    output: "File text, capped at 20,000 characters; files over 2 MB are refused.",
    sideEffects: ["reads the filesystem inside an allowed root"],
    store: "—",
    invokes: ["local_read_text_file"],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const file = resolveRead(str(args.path), ctx);
      const stat = fs.statSync(file);
      if (stat.size > 2_000_000) throw new Error("File is larger than 2 MB; read a range instead.");
      return clamp(fs.readFileSync(file, "utf8"));
    },
  },
  {
    id: "write_file",
    label: "Write file",
    description: "Create or overwrite a text file inside an allowed folder.",
    danger: "write",
    approval: "always",
    category: "build",
    source: "core",
    input: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
    output: "`Wrote <n> chars to <path>`.",
    sideEffects: ["creates directories", "writes or overwrites one file", "appends an audit row"],
    store: "—",
    invokes: ["local_write_file"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const file = resolveSafe(str(args.path), ctx.roots);
      const content = str(args.content);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return `Wrote ${content.length} chars to ${file}`;
    },
  },
  {
    id: "open_path",
    label: "Open path",
    description: "Reveal a file or folder in the OS default application.",
    danger: "exec",
    approval: "always",
    category: "destroy",
    source: "core",
    input: { path: { type: "string" } },
    required: ["path"],
    output: "`Opened <path>` or the OS error string.",
    sideEffects: ["launches the OS default handler", "appends an audit row"],
    store: "—",
    invokes: ["local_open_path"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const file = resolveSafe(str(args.path), ctx.roots);
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
      return `Opened ${file}`;
    },
  },
  {
    id: "run_command",
    label: "Run command",
    description: "Run a shell command with its working directory inside an allowed folder.",
    danger: "exec",
    approval: "always",
    category: "build",
    source: "ours",
    input: {
      command: { type: "string" },
      cwd: { type: "string", description: "Defaults to the first allowed folder." },
    },
    required: ["command"],
    output: "`exit <code>` plus stdout and stderr, capped at 20,000 characters.",
    sideEffects: ["executes a shell command", "inherits this user's permissions", "30 s timeout", "appends an audit row"],
    store: "—",
    invokes: ["local_press_keys (no — shell exec)"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const command = str(args.command);
      if (!command) throw new Error("No command provided.");
      const cwd = resolveSafe(str(args.cwd) || ctx.roots[0], ctx.roots);
      if (ctx.signal.aborted) throw new Error("Cancelled before the command started.");
      return await new Promise<string>((resolve) => {
        exec(command, { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          const code = err && "code" in err ? err.code : 0;
          resolve(
            clamp(
              [
                `exit ${code ?? 0}`,
                stdout ? `stdout:\n${stdout}` : "",
                stderr ? `stderr:\n${stderr}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            ),
          );
        });
      });
    },
  },
  {
    id: "remember",
    label: "Remember",
    category: "everyday",
    description: "Store a durable fact in long-term memory.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: { text: { type: "string" } },
    required: ["text"],
    output: "`Remembered: <first 160 chars>`.",
    sideEffects: ["appends to memory.json", "appends an audit row"],
    store: "useChatStore (memory view reads the same store)",
    invokes: [],
    emits: ["message_artifacts"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const text = str(args.text);
      // learnFact dedupes and replaces a near-duplicate fact, so a correction
      // saves as an update instead of a contradiction sitting beside the old one.
      const learned = ctx.store.learnFact(text);
      const entry = learned
        ? learned.entry
        : ctx.store.addMemory(text, "agent").slice(-1)[0];
      return `Remembered: ${entry.text.slice(0, 160)}`;
    },
  },
  {
    id: "recall",
    label: "Recall",
    category: "everyday",
    description: "Search long-term memory for facts relevant to a query.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: { query: { type: "string" } },
    required: ["query"],
    output: "A bullet list of up to 8 facts, or `Nothing stored about that yet.`",
    sideEffects: ["reads memory.json"],
    store: "useChatStore (memory view reads the same store)",
    invokes: [],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const hits = ctx.store.recall(str(args.query), 8);
      return hits.length ? hits.map((m) => `- ${m.text}`).join("\n") : "Nothing stored about that yet.";
    },
  },
  {
    id: "documents_write",
    label: "Write document",
    description: "Save a titled document into this world's local library.",
    danger: "write",
    approval: "manual",
    category: "everyday",
    source: "unverified",
    input: {
      title: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["body"],
    output: "`Saved “<title>” (<id>)`.",
    sideEffects: ["appends to documents.json", "appends an audit row"],
    store: "useBrainFocusStore (local stand-in for the knowledge graph)",
    invokes: [],
    emits: ["knowledge_changed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const doc = ctx.store.addDocument({
        title: str(args.title) || undefined,
        body: str(args.body),
        agentId: ctx.agentId,
        tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t)).slice(0, 12) : [],
      });
      return `Saved “${doc.title}” (${doc.id})`;
    },
  },
  {
    id: "documents_search",
    label: "Search documents",
    category: "everyday",
    description: "Search this world's local document library.",
    danger: "read",
    approval: "never",
    source: "unverified",
    input: { query: { type: "string" } },
    required: ["query"],
    output: "A bullet list of matches with ids, or `No documents match that.`",
    sideEffects: ["reads documents.json"],
    store: "useBrainFocusStore (local stand-in for the knowledge graph)",
    invokes: [],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const hits = ctx.store.searchDocuments(str(args.query), 6);
      return hits.length
        ? hits.map((d) => `- ${d.title} (${d.id}) — ${d.body.slice(0, 120).replace(/\s+/g, " ")}`).join("\n")
        : "No documents match that.";
    },
  },
  {
    id: "workspace_info",
    label: "Workspace info",
    category: "everyday",
    description: "Report the folders this agent may touch and where data is stored.",
    danger: "read",
    approval: "never",
    source: "core",
    input: {},
    required: [],
    output: "Allowed roots, data directory and agent count.",
    sideEffects: ["none"],
    store: "—",
    invokes: ["get_workspace_info"],
    emits: [],
    listens: [],
    calls: [],
    async run(_args, ctx) {
      const outside = Boolean(ctx.store.getSettings().abilities?.readOutside);
      return [
        `data: ${ctx.store.dir}`,
        `agents: ${ctx.store.listAgents().length}`,
        ctx.roots.length || outside ? `allowed:\n${ctx.roots.map((r) => `  - ${r}`).join("\n")}${outside ? "\n  - any path (read outside folders is on)" : ""}` : "allowed: (none)",
      ].join("\n");
    },
  },
  {
    id: "browser_open_page",
    label: "Open a page",
    description: "Open an http(s) URL in the default browser.",
    danger: "exec",
    approval: "always",
    category: "everyday",
    source: "core",
    input: {
      url: { type: "string", description: "http:// or https:// URL." },
    },
    required: ["url"],
    output: "`Opened <url>`.",
    sideEffects: ["launches the default browser", "leaves the app", "appends an audit row"],
    store: "—",
    invokes: ["browser_open_page / chromium_open_page"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args) {
      const url = str(args.url);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("That is not a URL.");
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only http and https links can be opened.");
      await shell.openExternal(parsed.toString());
      return `Opened ${parsed.toString()}`;
    },
  },
  {
    id: "see_screen",
    label: "See the screen",
    category: "everyday",
    description:
      "Take a still of this computer's primary display and look at it. Use this when the person refers to what is on screen, asks you to check or debug a window, or says \"look at this\". Requires Screen access in Settings → Machine access.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {
      reason: { type: "string", description: "One short sentence on why the screen is needed." },
    },
    required: [],
    output: "The captured image, attached to the next turn, plus where it was saved.",
    sideEffects: ["captures the primary display", "writes one JPEG to the data folder", "appends an audit row"],
    store: "—",
    invokes: ["desktopCapturer.getSources"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(_args, ctx) {
      if (!ctx.store.getSettings().abilities?.screen) {
        throw new Error(
          "Screen access is off. The person can turn it on in Settings → Machine access, under “Screen access”.",
        );
      }
      const shot = await captureScreen(ctx.store.dir);
      // Push into the run's array, not onto a copy of it: the runtime reads the
      // array it handed us when the tool result comes back.
      ctx.pendingImages = ctx.pendingImages ?? [];
      ctx.pendingImages.push(shot.base64);
      return [
        `Captured the primary display at ${shot.width}×${shot.height}.`,
        `Saved to ${shot.path}.`,
        "The image is attached to this turn; describe only what you can actually see in it.",
      ].join("\n");
    },
  },
  {
    id: "guide_screen",
    label: "Guide the screen",
    category: "everyday",
    description:
      "Draw a click-through guide over the person's real screen: a spotlight around a control, an arrow pointing at it, and a short line beside it. Use this when walking someone through an app or a task. Coordinates are fractions of the screen from 0 to 1 (x,y is the top-left of the control), measured from a screenshot taken with see_screen. Steps advance with Ctrl+Alt+Right, back with Ctrl+Alt+Left, close with Escape. Pass an empty steps list to clear the guide. Never cover a password, card or ID field.",
    danger: "write",
    approval: "never",
    source: "ours",
    input: {
      goal: { type: "string", description: "The task being walked through, one short line." },
      steps: {
        type: "array",
        description: "Ordered steps. One control per step.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "One imperative sentence, at most 12 words." },
            title: { type: "string", description: "Optional short kicker, e.g. \"Insert the table\"." },
            x: { type: "number", description: "Left edge of the control, 0–1 of screen width." },
            y: { type: "number", description: "Top edge of the control, 0–1 of screen height." },
            width: { type: "number", description: "Width of the control, 0–1 of screen width." },
            height: { type: "number", description: "Height of the control, 0–1 of screen height." },
            label: { type: "string", description: "The words readable on the control." },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    output: "`Showing step 1 of <n> over the screen.` or `Guide cleared.`",
    sideEffects: ["shows transparent always-on-top windows on every display", "registers guide keys until cleared"],
    store: "—",
    invokes: ["BrowserWindow", "globalShortcut"],
    emits: ["guide_changed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      if (!ctx.store.getSettings().abilities?.screen) {
        throw new Error(
          "Screen access is off, so the guide cannot point. The person can turn it on in Settings → Machine access.",
        );
      }
      const steps = Array.isArray(args.steps) ? (args.steps as Record<string, unknown>[]) : [];
      if (steps.length === 0) {
        hideGuide();
        return "Guide cleared.";
      }
      const state = showGuide({
        goal: str(args.goal),
        steps: steps.slice(0, 12).map((step) => ({
          text: str(step.text),
          title: str(step.title) || undefined,
          x: num(step.x, Number.NaN),
          y: num(step.y, Number.NaN),
          width: num(step.width, Number.NaN),
          height: num(step.height, Number.NaN),
          label: str(step.label) || undefined,
        })),
      });
      if (!state.active) return "No usable steps were given, so nothing was drawn.";
      return [
        `Showing step 1 of ${state.steps.length} over the screen.`,
        "It is click-through: the person can still use the app underneath.",
        "They advance with Ctrl+Alt+Right, go back with Ctrl+Alt+Left, and dismiss with Escape. Call guide_screen again with new steps after the screen changes.",
      ].join("\n");
    },
  },
  {
    id: "desktop_look",
    label: "Look at a window",
    category: "everyday",
    description:
      "Read the controls of a window on this computer: the window title, the screen size, and up to 150 named controls with their pixel boxes. Use this before clicking or typing so the coordinates come from the machine, not from a guess. Requires “Control this computer” in Settings → Machine access.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {
      window: { type: "string", description: "Part of a window title. Omit for the window in front." },
    },
    required: [],
    output: "The window, screen size, control list with pixel boxes, and the other open windows.",
    sideEffects: ["reads the UI Automation control tree"],
    store: "—",
    invokes: ["powershell UIAutomation"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      if (!handsReady()) throw new Error("Hands are only available on Windows in this build.");
      const probe = await probeWindow(str(args.window) || undefined);
      return describeProbe(probe);
    },
  },
  {
    id: "desktop_click",
    label: "Click",
    category: "destroy",
    description:
      "Move the visible pointer to a point on screen and left-click it. Coordinates are pixels from desktop_look, not fractions. The person sees the pointer before the click and must approve it. Never click a purchase, send or delete control unless the person explicitly asked for that action.",
    danger: "exec",
    approval: "always",
    source: "ours",
    input: {
      x: { type: "number", description: "X pixel from desktop_look." },
      y: { type: "number", description: "Y pixel from desktop_look." },
      window: { type: "string", description: "Part of the target window title; omit for the last window looked at." },
      label: { type: "string", description: "Short words for the pointer, e.g. “Insert”" },
    },
    required: ["x", "y"],
    output: "`Clicked at <x>,<y> in “<window>”.`",
    sideEffects: ["moves the cursor", "sends a left click", "appends an audit row"],
    store: "—",
    invokes: ["powershell SendInput"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args) {
      if (!handsReady()) throw new Error("Hands are only available on Windows in this build.");
      const result = await clickAt(num(args.x), num(args.y), {
        title: str(args.window) || undefined,
        label: str(args.label) || undefined,
      });
      return `Clicked at ${result.x},${result.y} in “${result.probe.window.title}”.`;
    },
  },
  {
    id: "desktop_type",
    label: "Type",
    category: "destroy",
    description:
      "Type text into the focused field of the last window looked at, by pasting through the clipboard. Use desktop_click first to put the caret where the text belongs. With submit, presses Enter afterwards. Requires approval.",
    danger: "exec",
    approval: "always",
    source: "ours",
    input: {
      text: { type: "string" },
      submit: { type: "boolean", description: "Press Enter after typing." },
      window: { type: "string", description: "Part of the target window title; omit for the last window looked at." },
    },
    required: ["text"],
    output: "`Typed <n> characters into “<window>”.`",
    sideEffects: ["restores the target window's focus", "pastes text through the clipboard", "appends an audit row"],
    store: "—",
    invokes: ["powershell SendKeys"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args) {
      if (!handsReady()) throw new Error("Hands are only available on Windows in this build.");
      const text = str(args.text);
      const probe = await typeText(text, Boolean(args.submit), str(args.window) || undefined);
      return `Typed ${text.length} characters into “${probe.window.title}”.`;
    },
  },
  {
    id: "desktop_key",
    label: "Press keys",
    category: "destroy",
    description:
      "Press a key or shortcut in the last window looked at: “ENTER”, “CTRL+S”, “ALT+TAB”, “F5”. Requires approval.",
    danger: "exec",
    approval: "always",
    source: "ours",
    input: {
      keys: { type: "string", description: "A key or chord, e.g. ENTER, TAB, CTRL+S, ALT+F4." },
      window: { type: "string" },
    },
    required: ["keys"],
    output: "`Pressed <keys> in “<window>”.`",
    sideEffects: ["restores the target window's focus", "sends keystrokes", "appends an audit row"],
    store: "—",
    invokes: ["powershell SendKeys"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args) {
      if (!handsReady()) throw new Error("Hands are only available on Windows in this build.");
      const probe = await pressKeys(str(args.keys), str(args.window) || undefined);
      return `Pressed ${str(args.keys)} in “${probe.window.title}”.`;
    },
  },
  {
    id: "desktop_scroll",
    label: "Scroll",
    category: "destroy",
    description: "Scroll the last window looked at. Positive is up, negative is down, one step is one wheel notch.",
    danger: "exec",
    approval: "always",
    source: "ours",
    input: {
      amount: { type: "number", description: "Wheel notches: 3 scrolls up, -3 down." },
      x: { type: "number", description: "Optional pixel to put the cursor over first." },
      y: { type: "number" },
    },
    required: ["amount"],
    output: "`Scrolled <amount> in “<window>”.`",
    sideEffects: ["moves the cursor if x/y are given", "sends a wheel event", "appends an audit row"],
    store: "—",
    invokes: ["powershell mouse_event"],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args) {
      if (!handsReady()) throw new Error("Hands are only available on Windows in this build.");
      const probe = await scroll(num(args.amount), typeof args.x === "number" ? args.x : undefined, typeof args.y === "number" ? args.y : undefined);
      return `Scrolled ${num(args.amount)} in “${probe.window.title}”.`;
    },
  },
  {
    id: "vault_search",
    label: "Search the vault",
    category: "everyday",
    description:
      "Search the person's local document vault (files they imported plus notes) and return cited passages. Use this before answering from a document, and cite as [title, passage n].",
    danger: "read",
    approval: "never",
    source: "ours",
    input: { query: { type: "string", description: "What to look for, in the person's words." } },
    required: ["query"],
    output: "Numbered passages with document title, passage number and score; or `Nothing in the vault matches that.`",
    sideEffects: ["reads vault.json locally"],
    store: "vault.json",
    invokes: [],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const hits = ctx.vault?.search(str(args.query), 6) ?? [];
      if (hits.length === 0) {
        return "Nothing in the vault matches that. The person can add files in Settings → Documents → Vault.";
      }
      return hits
        .map(
          (hit, i) =>
            `${i + 1}. “${hit.title}”, passage ${hit.chunk} (score ${hit.score})\n${hit.text}\nCite this as [${hit.title}, passage ${hit.chunk}].`,
        )
        .join("\n\n");
    },
  },
  {
    id: "vault_add",
    label: "Add to the vault",
    category: "everyday",
    description:
      "Save a long note, briefing or excerpt into the local document vault so it can be searched and cited later. Short facts belong in remember instead.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: {
      title: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["body"],
    output: "`Added “<title>” to the vault (<n> passages).`",
    sideEffects: ["writes vault.json", "appends an audit row"],
    store: "vault.json",
    invokes: [],
    emits: ["vault_changed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      if (!ctx.vault) throw new Error("The vault is not available in this build.");
      const doc = ctx.vault.add({
        title: str(args.title) || undefined,
        body: str(args.body),
        tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : [],
      });
      return `Added “${doc.title}” to the vault (${doc.chunks} passage${doc.chunks === 1 ? "" : "s"}).`;
    },
  },
  {
    id: "read_pack",
    label: "Read a context pack",
    category: "everyday",
    description:
      "Read a named context pack — a bundle of notes, guardrails and reference the person attached to this conversation. The attached pack is already in your context; use this for the others or to re-read it.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: { name: { type: "string", description: "Pack name; omit for the attached pack." } },
    required: [],
    output: "The pack body, capped at 40,000 characters, or the list of pack names.",
    sideEffects: ["reads packs.json"],
    store: "packs.json",
    invokes: [],
    emits: [],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const wanted = str(args.name).trim().toLowerCase();
      const packs = ctx.store.listPacks();
      const pack = wanted
        ? packs.find((p) => p.name.toLowerCase() === wanted || p.id === wanted)
        : ctx.store.getAttachedPack() ?? packs[0];
      if (!pack) {
        return packs.length
          ? `No pack is attached. Available: ${packs.map((p) => p.name).join(", ")}.`
          : "No context packs exist yet. Settings → Documents → Context packs creates them.";
      }
      return [`# ${pack.name}`, pack.description, pack.body.slice(0, 40_000)].filter(Boolean).join("\n\n");
    },
  },
  {
    id: "create_skill",
    label: "Write a skill",
    category: "build",
    description:
      "Save a reusable procedure as a skill so you can follow it next time. Use this once a multi-step job has worked and is likely to come back.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: {
      name: { type: "string", description: "Short name, e.g. “Publish a weekly changelog”." },
      description: { type: "string", description: "One sentence: when to use it." },
      instructions: { type: "string", description: "Numbered steps, including where to ask before acting." },
    },
    required: ["name", "instructions"],
    output: "`Saved skill <name>`.",
    sideEffects: ["writes one record to skills.json", "appends an audit row"],
    store: "skills.json",
    invokes: [],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const name = str(args.name).trim();
      const instructions = str(args.instructions).trim();
      if (!name || !instructions) throw new Error("A skill needs a name and instructions.");
      const existing = ctx.store
        .listSkills()
        .find((s) => s.name.toLowerCase() === name.toLowerCase());
      const saved = ctx.store.saveSkill({
        id: existing?.id,
        name,
        description: str(args.description),
        instructions,
        source: "learned",
        uses: (existing?.uses ?? 0) + 1,
      });
      return `Saved skill “${saved.name}”. It will be in your instructions from the next turn on.`;
    },
  },
  {
    id: "set_reminder",
    label: "Set a reminder",
    category: "everyday",
    description:
      "Schedule something for later. kind=reminder shows a notification with `text`; kind=routine runs `text` as a prompt in the chat. Use a clock time for daily/weekdays/weekly, or an ISO datetime for once. This runs even after the app restarts.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: {
      name: { type: "string", description: "Short label, as in Stand-up or Water the plants." },
      kind: { type: "string", enum: ["reminder", "routine"], description: "reminder = notify; routine = run a prompt." },
      text: { type: "string", description: "What to say, or the prompt to run." },
      when: { type: "string", enum: ["once", "daily", "weekdays", "weekly"], description: "Which clock." },
      time: { type: "string", description: "HH:MM in the person's local clock, for daily/weekdays/weekly." },
      at: { type: "string", description: "ISO datetime, for once." },
      weekday: { type: "number", description: "0=Sunday … 6=Saturday, for weekly." },
    },
    required: ["name", "text", "when"],
    output: "`Scheduled <name> — <when it will next run>`.",
    sideEffects: ["writes one record to routines.json", "appends an audit row"],
    store: "routines.json",
    invokes: [],
    emits: ["tool_executed"],
    listens: [],
    calls: [],
    async run(args, ctx) {
      const name = str(args.name).trim() || str(args.text).slice(0, 40);
      const text = str(args.text).trim();
      const when = str(args.when) || "once";
      if (!name || !text) throw new Error("A reminder needs a name and some text.");
      let schedule: RoutineSchedule;
      if (when === "once") {
        const at = Date.parse(str(args.at));
        if (!Number.isFinite(at)) throw new Error("For a one-off, pass `at` as an ISO datetime.");
        schedule = { kind: "once", at };
      } else {
        const time = /^\d{1,2}:\d{2}$/.test(str(args.time)) ? str(args.time) : "09:00";
        if (when === "weekly") {
          schedule = { kind: "weekly", weekday: Math.min(6, Math.max(0, Number(args.weekday) || 1)), time };
        } else if (when === "weekdays") {
          schedule = { kind: "weekdays", time };
        } else {
          schedule = { kind: "daily", time };
        }
      }
      const saved = ctx.store.saveRoutine({
        name,
        prompt: text,
        kind: str(args.kind) === "routine" ? "routine" : "reminder",
        schedule,
        agentId: ctx.agentId,
      });
      return `Scheduled “${saved.name}” — ${describeSchedule(saved.schedule)}.`;
    },
  },
  {
    id: "list_reminders",
    label: "List reminders",
    category: "everyday",
    description: "List what is scheduled: reminders and routines, with the next time and whether it is on.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {},
    required: [],
    output: "One line per routine, or `Nothing is scheduled.`",
    sideEffects: ["reads routines.json"],
    store: "routines.json",
    invokes: [],
    emits: [],
    listens: [],
    calls: [],
    async run(_args, ctx) {
      const rows = ctx.store.listRoutines();
      if (rows.length === 0) return "Nothing is scheduled.";
      return rows
        .map(
          (r) =>
            `${r.enabled ? "on" : "off"} · ${r.name} · ${describeSchedule(r.schedule)} · next ${new Date(r.nextAt).toLocaleString()}${r.kind === "routine" ? " · runs a prompt" : ""}`,
        )
        .join("\n");
    },
  },
  {
    id: "browser_tabs",
    label: "Browser tabs",
    category: "everyday",
    description:
      "List or manage the tabs in the signed-in browser. action=list shows open pages with their ids; active shows the page you are on.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {
      action: { type: "string", enum: ["list", "active", "new", "close"] },
      url: { type: "string", description: "For action=new." },
      page: { type: "number", description: "For action=close: page id." },
    },
    required: ["action"],
    output: "Neo's tab list, or the opened/closed page.",
    sideEffects: ["reads or changes browser tabs", "appends an audit row"],
    store: "—",
    invokes: ["neo tabs"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const action = str(args.action) || "list";
      const payload: Record<string, unknown> = { action };
      if (str(args.url)) payload.url = str(args.url);
      if (typeof args.page === "number") payload.page = args.page;
      return browserCall("tabs", payload);
    },
  },
  {
    id: "browser_open",
    label: "Open a page in the browser",
    category: "everyday",
    description:
      "Open a URL in a new background tab of the signed-in browser and return a snapshot of the page. Prefer this over opening the default browser: this one keeps the person's logins.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: { url: { type: "string", description: "http:// or https:// URL." } },
    required: ["url"],
    output: "The new page id and an accessibility snapshot.",
    sideEffects: ["opens a browser tab", "appends an audit row"],
    store: "—",
    invokes: ["neo tabs"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const url = str(args.url);
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== "about:") {
          throw new Error("Only http, https or about: URLs can be opened.");
        }
      } catch {
        throw new Error("That is not a URL.");
      }
      return browserCall("tabs", { action: "new", url });
    },
  },
  {
    id: "browser_read",
    label: "Read a page",
    category: "everyday",
    description:
      "Read the current browser page as markdown or text. Omit page to read the active tab. Use snapshot instead when you need clickable element refs.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {
      page: { type: "number", description: "Page id from browser_tabs. Omit for the active tab." },
      format: { type: "string", enum: ["markdown", "text", "links", "console"] },
      selector: { type: "string", description: "Optional CSS subtree." },
    },
    required: [],
    output: "The page content.",
    sideEffects: ["reads the current page", "appends an audit row"],
    store: "—",
    invokes: ["neo read"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const page = await resolvePage(args.page);
      const payload: Record<string, unknown> = { page, format: str(args.format) || "markdown" };
      if (str(args.selector)) payload.selector = str(args.selector);
      return browserCall("read", payload);
    },
  },
  {
    id: "browser_snapshot",
    label: "Snapshot a page",
    category: "everyday",
    description:
      "Capture a browser page as an accessibility tree. Each actionable element has a [ref=eN] you pass to browser_act.",
    danger: "read",
    approval: "never",
    source: "ours",
    input: {
      page: { type: "number", description: "Page id. Omit for the active tab." },
      mode: { type: "string", enum: ["full", "interactive"] },
    },
    required: [],
    output: "The snapshot with element refs.",
    sideEffects: ["reads the page", "appends an audit row"],
    store: "—",
    invokes: ["neo snapshot"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const page = await resolvePage(args.page);
      const payload: Record<string, unknown> = { page };
      if (str(args.mode)) payload.mode = str(args.mode);
      return browserCall("snapshot", payload);
    },
  },
  {
    id: "browser_act",
    label: "Act on a page",
    category: "everyday",
    description:
      "Click, type, fill, press, select or scroll on a browser page using refs from browser_snapshot. Fill a whole form in one call with fields.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: {
      page: { type: "number", description: "Page id. Omit for the active tab." },
      kind: { type: "string", description: "click | fill | type | press | hover | focus | check | uncheck | select | scroll | drag | dialog_accept | dialog_dismiss" },
      ref: { type: "string", description: "Element ref from a snapshot, e.g. e12." },
      value: { type: "string", description: "Text/value for fill, type, select or press." },
      key: { type: "string", description: "Key or combo for press." },
      fields: { type: "array", description: "[{ref,value}] to fill many fields at once.", items: { type: "object", properties: { ref: { type: "string" }, value: { type: "string" } }, required: ["ref", "value"] } },
      direction: { type: "string", description: "Scroll direction: up | down | left | right." },
      amount: { type: "number", description: "Scroll amount." },
    },
    required: ["kind"],
    output: "A diff of what changed.",
    sideEffects: ["interacts with a signed-in browser page", "appends an audit row"],
    store: "—",
    invokes: ["neo act"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const page = await resolvePage(args.page);
      const { page: _page, ...rest } = args;
      return browserCall("act", { ...rest, page });
    },
  },
  {
    id: "browser_run",
    label: "Run browser steps",
    category: "everyday",
    description:
      "Drive several browser steps in one call with JavaScript against neo's browser SDK: browser.open(url), page.snapshot(), page.click(ref), page.fill(ref,value), page.read(), page.evaluate(). Prefer this for multi-step or repeated work.",
    danger: "write",
    approval: "manual",
    source: "ours",
    input: { code: { type: "string", description: "Async JavaScript body. Use top-level await and `return` a value." } },
    required: ["code"],
    output: "Console output and the returned value.",
    sideEffects: ["drives the signed-in browser", "appends an audit row"],
    store: "—",
    invokes: ["neo run"],
    emits: [],
    listens: [],
    calls: [],
    async run(args) {
      const code = str(args.code);
      if (!code.trim()) throw new Error("No browser code was given.");
      return browserCall("run", { code }, 75_000);
    },
  },
  {
    id: "notify",
    label: "Notify",
    category: "destroy",
    description: "Raise a desktop notification from this agent.",
    danger: "write",
    approval: "manual",
    source: "unverified",
    input: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title"],
    output: "`Notified: <title>`.",
    sideEffects: ["shows an OS notification", "appends an audit row"],
    store: "notifications store",
    invokes: [],
    emits: ["message_artifacts"],
    listens: [],
    calls: [],
    async run(args) {
      const title = str(args.title).slice(0, 120);
      const body = str(args.body).slice(0, 400);
      if (!Notification.isSupported()) return "Notifications are not supported on this system.";
      new Notification({ title, body }).show();
      return `Notified: ${title}`;
    },
  },
  {
    id: "delegate_task",
    label: "Delegate",
    description:
      "Hand a scoped task to another companion in this world. Returns at once; the answer arrives in the conversation when the worker is done, so keep talking meanwhile.",
    danger: "write",
    approval: "manual",
    category: "everyday",
    source: "core",
    input: {
      target: { type: "string", description: "Companion name or id." },
      brief: { type: "string", description: "A self-contained task brief." },
    },
    required: ["target", "brief"],
    output: "A dispatch receipt. The child's final text is posted to the thread when it finishes.",
    sideEffects: ["starts a second agent run", "writes a task audit row for both runs", "consumes the same local usage meter"],
    store: "useSwarmStore (orchestrators, dispatch pulses)",
    invokes: ["run_prompt"],
    emits: ["task_dispatched", "bot_spawned", "task_completed", "task_status_ack"],
    listens: [],
    calls: ["run_prompt"],
    async run(args, ctx) {
      if (!ctx.delegate) throw new Error("Delegation is not available in this runtime.");
      const target = str(args.target);
      const brief = str(args.brief);
      if (!target || !brief) throw new Error("Delegation needs a target and a brief.");
      const answer = await ctx.delegate(target, brief);
      return `Delegated to ${target}:\n${answer}`;
    },
  },
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

/**
 * Settings → Companion → Abilities. A hard stop, not a prompt instruction: with a
 * switch off the tool never reaches the approval card, so nothing can talk its
 * way past the setting. `undefined` means the renderer has not synced yet and
 * the older behaviour (roots + approvals) still applies.
 */
export function abilitiesRefuse(tool: ToolDef, store: Store): string | null {
  const abilities = store.getSettings().abilities;
  if (!abilities) return null;
  if (tool.id === "run_command" && !abilities.shell) {
    return "Terminal access is off. Turn it on in Settings → Companion → Abilities.";
  }
  if (tool.id === "write_file" && !abilities.write) {
    return "Writing files is off. Turn it on in Settings → Companion → Abilities.";
  }
  if (tool.id === "browser_open_page" && !abilities.network) {
    return "Network access is off. Turn it on in Settings → Companion → Abilities.";
  }
  if (tool.id.startsWith("browser_") && !abilities.network) {
    return "Browser access is off. Turn on Reach the network in Settings → Companion → Abilities.";
  }
  if ((tool.id === "see_screen" || tool.id === "guide_screen") && !abilities.screen) {
    return "Screen access is off. Turn it on in Settings → Machine access.";
  }
  if (tool.id.startsWith("desktop_") && !abilities.hands) {
    return "“Control this computer” is off. Turn it on in Settings → Machine access.";
  }
  return null;
}

/** One MCP call, with a message a person can act on when neo is closed. */
async function browserCall(tool: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<string> {
  try {
    return await neo.call(tool, args, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The signed-in browser is not answering (${message}). Open BrowserOS neo and make sure its local server is running, then try again.`,
    );
  }
}

/**
 * Neo can read the active tab without being told its id. Pull the first page id
 * out of its answer; if there is none, say so rather than guessing.
 */
async function resolvePage(input: unknown): Promise<number> {
  if (typeof input === "number" && Number.isFinite(input)) return Math.round(input);
  const text = await browserCall("tabs", { action: "active" });
  const match = /\b(?:page\s+|\[)(\d{1,6})\b/i.exec(text);
  if (!match) throw new Error("No browser page is active. Open one with browser_open first.");
  return Number(match[1]);
}

export function findTool(id: string): ToolDef | undefined {
  return byId.get(id);
}

/** Tools an agent may see. An empty allow-list means the whole registry. */
export function toolsFor(allow?: string[]): ToolDef[] {
  if (!allow || allow.length === 0) return TOOLS;
  const allowed = new Set(allow);
  return TOOLS.filter((t) => allowed.has(t.id));
}

export function toolSchemas(allow?: string[]): ToolSchema[] {
  return toolsFor(allow).map(schema);
}

export function summarise(id: string, args: Record<string, unknown>): string {
  switch (id) {
    case "run_command":
      return str(args.command);
    case "write_file":
      return `${str(args.path)}  (${str(args.content).length} chars)`;
    case "read_file":
    case "list_files":
    case "open_path":
      return str(args.path);
    case "remember":
    case "documents_write":
      return str(args.text ?? args.title ?? args.body).slice(0, 160);
    case "recall":
    case "documents_search":
      return str(args.query);
    case "browser_open_page":
    case "browser_open":
      return str(args.url);
    case "browser_tabs":
      return `${str(args.action) || "list"}${str(args.url) ? ` — ${str(args.url)}` : ""}`;
    case "browser_read":
    case "browser_snapshot":
      return typeof args.page === "number" ? `page ${args.page}` : "active page";
    case "browser_act":
      return `${str(args.kind)} ${str(args.ref) || ""}`.trim();
    case "browser_run":
      return str(args.code).slice(0, 120);
    case "see_screen":
      return str(args.reason) || "screen capture";
    case "desktop_look":
      return str(args.window) || "window in front";
    case "desktop_click":
      return `${str(args.x)},${str(args.y)}${str(args.label) ? ` — ${str(args.label)}` : ""}`;
    case "desktop_type":
      return str(args.text).slice(0, 120);
    case "desktop_key":
      return str(args.keys);
    case "desktop_scroll":
      return String(args.amount ?? "");
    case "create_skill":
      return str(args.name);
    case "set_reminder":
      return `${str(args.name)} — ${str(args.when)}${str(args.time) ? ` ${str(args.time)}` : ""}`;
    case "list_reminders":
      return "the schedule";
    case "notify":
      return str(args.title);
    case "delegate_task":
      return `${str(args.target)} — ${str(args.brief).slice(0, 120)}`;
    default:
      return JSON.stringify(args).slice(0, 160);
  }
}

/** Used by the audit row: a stable sentence the ledger view can print. */
export function describe(id: string, args: Record<string, unknown>): string {
  const tool = findTool(id);
  if (!tool) return id;
  return `${tool.label}: ${summarise(id, args) || "(no args)"}`;
}

export { clamp, resolveSafe, num };
