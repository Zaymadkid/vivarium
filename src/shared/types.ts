/**
 * The shared contract.
 *
 * This file is the only place the renderer, the preload bridge and the main
 * process agree on shapes. Everything here is JSON-serialisable: the whole runtime
 * crosses `ipcRenderer.invoke` at least once.
 *
 * Naming note: the agent fields (`agent_type`, `system_prompt`,
 * `is_orchestrator`, `color`, `parent_companion_id`) keep their snake_case
 * serialised form: they are written to disk and read back by older versions.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  at: number;
  name?: string;
  toolCallId?: string;
  /** Whose conversation this belongs to. Absent on rows written before that split. */
  agentId?: string;
  /** The turn that produced an answer, so it can be rated. */
  runId?: string;
}

export type AgentState = "idle" | "thinking" | "blocked" | "error";

/** `bot` is a transient worker, not a companion. */
export type AgentType = "orchestrator" | "companion" | "bot";

/** How much consent a tool needs before it runs. */
export type ApprovalPolicy = "never" | "manual" | "always";

export interface AgentRecord {
  id: string;
  name: string;
  persona: string;
  hue: number;
  state: AgentState;
  position: [number, number, number];

  /** Display role, e.g. `guide`, `researcher`. Reference `role`. */
  role?: string;
  /** Reference `agent_type`; defaults to `companion`. */
  agentType?: AgentType;
  /** Reference `system_prompt`; falls back to `persona`. */
  systemPrompt?: string;
  /** Model override; falls back to the provider's configured model. */
  model?: string;
  /** Provider override for this companion; falls back to Settings → Mind. */
  provider?: ProviderId;
  /** Tool ids this agent may call. Empty/undefined = the whole registry. */
  tools?: string[];
  /** Per-agent approval override. */
  approval?: ApprovalPolicy;
  /** Reference `color`; derived from `hue` when absent. */
  color?: string;
  /** Reference `parent_companion_id` — set on delegated bots. */
  parentId?: string;
  /** Reference `is_orchestrator`. */
  isOrchestrator?: boolean;
  /** Tool ids this agent approved with “always”. Survives restarts. */
  alwaysAllow?: string[];
  createdAt?: number;
}

export type ProviderId =
  | "mock"
  | "openai"
  | "ollama"
  | "opencode"
  | "codebuddy"
  | "claude"
  | "codex"
  | "gemini"
  | "custom-cli";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: "http" | "cli" | "mock";
  requiresKey: boolean;
  supportsTools: boolean;
  defaultModel: string;
  hint: string;
  /** Optional static model list; the live list comes from `listModels()`. */
  models?: string[];
}

export interface Settings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  cliCommand: string;
  hasKey: boolean;
  /** ElevenLabs key is held in the OS keychain; this is only "is one set". */
  hasVoiceKey?: boolean;
  /** Chosen ElevenLabs voice id. Empty means the account's first voice. */
  voiceId?: string;
  roots: string[];
  accent: string;
  reducedMotion: boolean;
  /** The Knot is a slim bar at the top of the screen instead of an orb. */
  island?: boolean;
  /**
   * Reference `/user/tool-approval-config` + `Actions: auto|manual`.
   * `ask` = consequential tools raise a card; `auto` = they run unattended
   * (destructive tools still ask when their policy is `always`).
   */
  actions?: "ask" | "auto";
  /**
   * Settings → Companion → Identity, mirrored here so the runtime — not just
   * the renderer — can put it in front of the model on every run.
   */
  persona?: {
    name?: string;
    preamble?: string;
    personality?: "quiet" | "balanced" | "narrated";
    tone?: "casual" | "warm" | "formal";
    proactivity?: "asked" | "often";
    goal?: string;
    interview?: string;
  };
  /** Settings → Preferences → Without asking first. Those categories run alone. */
  autonomy?: { everyday: boolean; build: boolean; destroy: boolean };
  /** Settings → Companion → Abilities. Hard stops checked before a tool is offered. */
  abilities?: {
    shell: boolean;
    write: boolean;
    network: boolean;
    readOutside: boolean;
    /** Let her look at this machine's screen. Off means the capture tool refuses. */
    screen?: boolean;
    /** Let her move the mouse and type on this computer, always with approval. */
    hands?: boolean;
  };
  /**
   * What she is allowed to teach herself. Both default on: a memory is a note
   * about the person, a skill is a procedure she can reuse. Either can be
   * switched off in Settings → Companion → Abilities.
   */
  learning?: { memory: boolean; skills: boolean };
  /** Settings → Channels → On this computer: native OS notifications. */
  notifyOs?: boolean;
  /** Who she is talking to. Used to greet them, never sent anywhere else. */
  you?: { name?: string; email?: string };
}

export type Danger = "read" | "write" | "exec";

export interface ApprovalRequest {
  requestId: string;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  danger: Danger;
  summary: string;
}

export type ChatEvent =
  | { type: "delta"; runId: string; text: string }
  /** The provider started a new assistant message; drop the text streamed so far. */
  | { type: "reset"; runId: string }
  | { type: "tool-start"; runId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool-end"; runId: string; tool: string; ok: boolean; result: string }
  | { type: "approval"; runId: string; request: ApprovalRequest }
  /** A worker was handed a brief. Reference `agent_dispatched`. */
  | { type: "dispatch"; runId: string; agentId: string; agentName: string; brief: string }
  /** A background worker finished. Reference `task_completed`. */
  | { type: "report"; runId: string; agentId: string; agentName: string; text: string; ok: boolean }
  | { type: "agent-state"; agentId: string; state: AgentState }
  /** The learning pass kept something from a finished turn. */
  | { type: "learned"; runId: string; memories: number; skill?: string }
  /** The finished answer, de-duplicated. Replaces the text streamed so far. */
  | { type: "final"; runId: string; text: string }
  | { type: "done"; runId: string }
  | { type: "error"; runId: string; message: string };

/**
 * A diagram the model writes into an answer.
 *
 * The model authors the structure, not the pixels: the renderer owns layout,
 * panning and zooming, so one shape works at any window size and every node can
 * carry a detail panel the person can open and ask about.
 */
export type DiagramKind = "start" | "step" | "decision" | "data" | "note" | "warning";

export interface DiagramNode {
  id: string;
  label: string;
  detail?: string;
  kind?: DiagramKind;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface DiagramSpec {
  title?: string;
  direction?: "lr" | "tb";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface MemoryEntry {
  id: string;
  text: string;
  at: number;
  source: string;
}

export interface AuditEntry {
  at: number;
  agentId: string;
  tool: string;
  danger: Danger;
  decision: "allowed" | "denied" | "auto";
  summary: string;
  ok: boolean;
  /** Which run produced the entry. Present on every new row. */
  runId?: string;
  agentName?: string;
  /** `tool` for a tool call, `run` for the run lifecycle rows. */
  kind?: "tool" | "run";
}

/** Local stand-in for `/user/usage`: what a run cost. */
export interface UsageRecord {
  runs: number;
  toolCalls: number;
  inputChars: number;
  outputChars: number;
  estTokens: number;
  updatedAt: number;
}

export type RunStatus = "running" | "done" | "cancelled" | "error";

/** The approach a run took. Mined so the next similar task starts better. */
export type WorkflowStrategy = "direct" | "plan" | "tool-first" | "research" | "clarify";

export interface WorkflowRecord {
  id: string;
  /** Human-readable shape of the task, e.g. "count words in readme". */
  task: string;
  keywords: string[];
  strategy: WorkflowStrategy;
  tools: string[];
  provider: string;
  model: string;
  attempts: number;
  successes: number;
  totalMs: number;
  lastAt: number;
}

export interface RunRecord {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  hops: number;
  toolCalls: number;
  inputChars: number;
  outputChars: number;
  /** The workflow row this run fed, so a thumbs-down can correct it. */
  workflowId?: string;
  /** The person's verdict, kept separate from whether the run finished. */
  feedback?: "up" | "down";
}

/** One thumb, tied to the answer it was given for. */
export interface FeedbackRecord {
  runId: string;
  agentId: string;
  value: "up" | "down";
  at: number;
  workflowId?: string;
}

/** What `session_init` allocates for an agent. Reference `/byo-sub/session-init/:id`. */
export interface SessionRecord {
  id: string;
  agentId: string;
  createdAt: number;
  connection: "local";
  systemPrompt: string;
  model: string;
  tools: string[];
}

/** One file inside a folder the person allowed, for the viewer's list. */
export interface FileNode {
  path: string;
  name: string;
  /** Folder path relative to the allowed root (`"."` at the root). */
  dir: string;
  root: string;
  size: number;
  at: number;
}

/** What the viewer shows once a file is opened. */
export interface FilePreview {
  path: string;
  name: string;
  text: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  instructions: string;
  docs: string[];
  integrations: string[];
  source: "manual" | "learned";
  uses: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Something she does later, on a clock, without being asked again.
 *
 * A reminder is words on screen; a routine is a prompt she runs and answers in
 * the chat. Both survive a restart because the schedule and the history live in
 * the app's own folder, and both are visible and cancellable.
 */
export interface RoutineRecord {
  id: string;
  name: string;
  kind: "reminder" | "routine";
  /** For a reminder, what to say; for a routine, what to ask. */
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  agentId?: string;
  createdAt: number;
  nextAt: number;
  lastAt?: number;
  runs: RoutineRun[];
}

export type RoutineSchedule =
  | { kind: "once"; at: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string };

export interface RoutineRun {
  id: string;
  at: number;
  status: "ok" | "error";
  detail: string;
  runId?: string;
}

/** One row on the Integrations screen, measured rather than promised. */
export interface IntegrationStatus {
  id: string;
  name: string;
  category: "Browser" | "Model" | "Voice" | "Tools" | "Files";
  status: "ready" | "offline" | "unconfigured";
  detail: string;
  needs: string;
  /** Where the person goes to fix it. */
  action?: "settings" | "mind" | "voice" | "folders";
}

/** What the Usage pane reads: this machine's own meter, never billing. */
export interface UsageReport {
  usage: UsageRecord;
  runs: RunRecord[];
  memories: number;
  skills: number;
  workflows: WorkflowRecord[];
  feedback: FeedbackRecord[];
  firstAt: number;
}

export interface ScreenPreview {
  dataUrl: string;
  width: number;
  height: number;
  at: number;
}

/**
 * One pointed-at step in the screen guide.
 *
 * `x/y/width/height` are fractions of the display (0–1, origin top-left), which
 * is what a vision model can estimate from a screenshot without knowing the
 * monitor's pixel size. Omit them to show the line without a target.
 */
export interface GuideStep {
  text: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** The words she can read on the control, shown as a chip by the pointer. */
  label?: string;
}

export interface GuidePayload {
  /** The task being walked through, shown in the bubble's kicker. */
  goal?: string;
  steps: GuideStep[];
}

export interface GuideState {
  active: boolean;
  /** `hand` is a transient pointer for an action, with no veil or bubble. */
  mode?: "guide" | "hand";
  steps: GuideStep[];
  index: number;
  goal?: string;
}

/** A document in the recall vault. Chunks live beside it, not in this row. */
export interface VaultDocument {
  id: string;
  title: string;
  /** Absolute path for an imported file, `note` for something typed in-app. */
  source: string;
  kind: "note" | "file";
  tags: string[];
  chars: number;
  chunks: number;
  at: number;
  updatedAt: number;
}

/** One cited passage from the vault, as the search returns it. */
export interface VaultHit {
  documentId: string;
  title: string;
  source: string;
  /** 1-based chunk number inside the document. */
  chunk: number;
  text: string;
  score: number;
}

/** A named bundle that rides along with every turn while it is attached. */
export interface ContextPack {
  id: string;
  name: string;
  description: string;
  body: string;
  at: number;
  updatedAt: number;
}

export interface VoiceOption {
  id: string;
  name: string;
  /** "warm · narration", from the voice's labels. */
  detail: string;
  preview: string;
}

export interface VoiceStatus {
  hasKey: boolean;
  voiceId: string;
  /** Where the key came from, so a person can tell env from keychain. */
  source: "keychain" | "environment" | "none";
  /** Which offline recogniser will hear you when the key is absent or out of credits. */
  stt?: {
    available: boolean;
    backend: string;
    model?: string;
    bin?: string;
    detail?: string;
  };
}

export interface VivApi {
  info(): Promise<{ version: string; platform: string; dataDir: string }>;
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    setKey(key: string): Promise<Settings>;
    pickRoot(): Promise<Settings>;
  };
  agents: {
    list(): Promise<AgentRecord[]>;
    save(agents: AgentRecord[]): Promise<AgentRecord[]>;
    setState(id: string, state: AgentState): Promise<void>;
  };
  chat: {
    /** One agent's conversation. Omitted = the whole thread. */
    history(agentId?: string): Promise<ChatMessage[]>;
    /** `spoken` shapes the reply for the ear: short, plain, no markdown. */
    send(agentId: string, text: string, spoken?: boolean): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    /** Words said while a run is already working; it adjusts at its next step. */
    steer(runId: string, text: string): Promise<boolean>;
    clear(): Promise<void>;
    onEvent(cb: (event: ChatEvent) => void): () => void;
  };
  overlay: {
    /** Show the on-screen Knot, collapsed or as it was left. */
    show(): Promise<boolean>;
    hide(): Promise<void>;
    toggle(): Promise<boolean>;
    /** Show the Knot and start listening on its microphone. */
    talk(): Promise<boolean>;
    /** The renderer owns its layout; the window follows. */
    resize(width: number, height: number): Promise<void>;
    /** Move and shape the Knot as a slim bar at the top of the screen. */
    island(on: boolean): Promise<void>;
    status(): Promise<{ visible: boolean; shortcut: string; registered: boolean }>;
    /** The global talk key fires this; toggles listening. */
    onTalk(cb: () => void): () => void;
    /** Point-and-ask: a screenshot and cursor spot are ready for the overlay. */
    onPoint(cb: (payload: { prompt: string }) => void): () => void;
    /** A short line for the overlay, such as why an action could not run. */
    onNotice(cb: (text: string) => void): () => void;
  };
  tools: {
    decide(requestId: string, decision: "allow" | "always" | "deny"): Promise<void>;
  };
  feedback: {
    /** Thumbs on one answer. `null` clears the verdict. */
    rate(runId: string, value: "up" | "down" | null): Promise<RunRecord[]>;
  };
  memory: {
    list(): Promise<MemoryEntry[]>;
    add(text: string): Promise<MemoryEntry[]>;
    /** Edit a fact in place, so what she knows stays true. */
    update(id: string, text: string): Promise<MemoryEntry[]>;
    forget(id: string): Promise<MemoryEntry[]>;
  };
  skills: {
    list(): Promise<SkillRecord[]>;
    save(skill: Partial<SkillRecord> & { name: string }): Promise<SkillRecord[]>;
    remove(id: string): Promise<SkillRecord[]>;
  };
  integrations: {
    /** Probe the services on this machine. No network beyond loopback. */
    scan(): Promise<IntegrationStatus[]>;
  };
  screen: {
    /** A still of the primary display, for Settings → Machine access. */
    preview(): Promise<ScreenPreview>;
    /** A frame for the live view; not written to disk. */
    live(): Promise<ScreenPreview>;
    status(): Promise<{ enabled: boolean; platform: string }>;
    /** A click the person asked for from the live view, as fractions of the display (0–1). */
    click(xFraction: number, yFraction: number, window?: string): Promise<{ x: number; y: number; window: string }>;
    type(text: string, submit?: boolean, window?: string): Promise<void>;
    key(keys: string, window?: string): Promise<void>;
    /** Windows a click can be sent to. */
    windows(): Promise<{ title: string; process: string; handle: number }[]>;
    /** Point and ask: capture the cursor's spot and answer in the Knot. */
    ask(): Promise<boolean>;
  };
  guide: {
    /** Show a pointed walkthrough over the real screen, click-through. */
    show(payload: GuidePayload): Promise<GuideState>;
    hide(): Promise<GuideState>;
    status(): Promise<GuideState>;
    step(delta: number): Promise<GuideState>;
    /** Every guide window follows the same state. */
    onState(cb: (state: GuideState) => void): () => void;
  };
  vault: {
    list(): Promise<VaultDocument[]>;
    add(input: { title?: string; body: string; tags?: string[] }): Promise<VaultDocument[]>;
    /** Pick files and ingest them; returns what was added and what was refused. */
    import(): Promise<{ documents: VaultDocument[]; skipped: string[] }>;
    importFolder(): Promise<{ documents: VaultDocument[]; skipped: string[] }>;
    search(query: string): Promise<VaultHit[]>;
    /** The whole document, reassembled from its passages. */
    read(id: string): Promise<{ document: VaultDocument; text: string } | null>;
    forget(id: string): Promise<VaultDocument[]>;
    status(): Promise<{ documents: number; chunks: number; dir: string }>;
  };
  routines: {
    list(): Promise<RoutineRecord[]>;
    save(
      input: Partial<RoutineRecord> & { name: string; prompt: string; schedule: RoutineSchedule },
    ): Promise<RoutineRecord[]>;
    remove(id: string): Promise<RoutineRecord[]>;
    /** Fire it now, without moving the schedule. */
    run(id: string): Promise<RoutineRecord[]>;
    /** A reminder or a finished routine, announced while the window is open. */
    onFire(cb: (event: { title: string; body: string }) => void): () => void;
  };
  packs: {
    list(): Promise<ContextPack[]>;
    save(input: Partial<ContextPack> & { name: string }): Promise<ContextPack[]>;
    remove(id: string): Promise<ContextPack[]>;
    attach(id: string | null): Promise<string | null>;
    attached(): Promise<string | null>;
  };
  usage: {
    get(): Promise<UsageReport>;
  };
  audit: {
    list(): Promise<AuditEntry[]>;
  };
  data: {
    exportAll(): Promise<string | null>;
    openDataDir(): Promise<void>;
    /** Clear companions, memory, skills, ledger and preferences; keep the app. */
    reset(): Promise<void>;
  };
  files: {
    list(): Promise<FileNode[]>;
    read(path: string): Promise<FilePreview>;
    image(path: string): Promise<{ path: string; name: string; dataUrl: string; bytes: number }>;
    open(path: string): Promise<void>;
  };
  voice: {
    status(): Promise<VoiceStatus>;
    setKey(key: string): Promise<VoiceStatus>;
    list(): Promise<VoiceOption[]>;
    /** Returns a `data:` URL of mp3 audio. */
    speak(text: string): Promise<{ audio: string }>;
    /** `bytes` is a recorded clip; returns what was said. */
    transcribe(bytes: Uint8Array, mime: string): Promise<string>;
    /** Installed OS voices (Windows SAPI). Free and offline. */
    systemVoices(): Promise<string[]>;
    /** Speak with the OS voice; resolves once playback starts. */
    systemSpeak(text: string, voice?: string): Promise<void>;
    /** A free Microsoft neural clip as a data URL, or null when unreachable. */
    neural(text: string, style?: string): Promise<string | null>;
    /** Copy a whisper.cpp install already on this PC into the app's own folder. */
    installStt(): Promise<VoiceStatus>;
    /** Reflexes: run a spoken command without waiting for a model. */
    action(text: string): Promise<{ handled: boolean; note?: string }>;
  };
  providers: ProviderInfo[];
}

declare global {
  interface Window {
    viv: VivApi;
  }
}
