import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AgentRecord,
  AuditEntry,
  ChatMessage,
  ContextPack,
  FeedbackRecord,
  MemoryEntry,
  RunRecord,
  RoutineRecord,
  RoutineRun,
  RoutineSchedule,
  SessionRecord,
  Settings,
  SkillRecord,
  UsageRecord,
  WorkflowRecord,
} from "../shared/types";
import { nextRunAt } from "../shared/schedule";
import { tidyAnswer } from "./tidy";

/**
 * Everything the app knows is a JSON file under `%APPDATA%/Vivarium`.
 * Append-only where it matters (`audit.jsonl`), atomic everywhere else
 * (write a temp file, then rename).
 *
 * There is no database and no schema migration in v0; the store normalises
 * records on read so an older file keeps working.
 */

const DEFAULT_SETTINGS: Settings = {
  provider: "mock",
  model: "vivarium-mock-1",
  baseUrl: "https://api.openai.com/v1",
  cliCommand: "",
  hasKey: false,
  hasVoiceKey: false,
  voiceId: "",
  roots: [],
  accent: "#35E29B",
  reducedMotion: false,
  island: false,
  actions: "ask",
};

interface StoredSettings extends Settings {
  keyEnc?: string;
  /** ElevenLabs, encrypted with the OS keychain like the model key. */
  voiceKeyEnc?: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  body: string;
  at: number;
  agentId?: string;
  tags: string[];
}

export class Store {
  readonly dir: string;
  private settings: StoredSettings;
  private agents: AgentRecord[] = [];
  private thread: ChatMessage[] = [];
  private memories: MemoryEntry[] = [];
  private documents: DocumentRecord[] = [];
  private sessions: SessionRecord[] = [];
  private usage: UsageRecord = {
    runs: 0,
    toolCalls: 0,
    inputChars: 0,
    outputChars: 0,
    estTokens: 0,
    updatedAt: 0,
  };
  private runs: RunRecord[] = [];
  private skills: SkillRecord[] = [];
  private workflows: WorkflowRecord[] = [];
  private packs: ContextPack[] = [];
  private attachedPack: string | null = null;
  private routines: RoutineRecord[] = [];
  private feedback: FeedbackRecord[] = [];

  constructor() {
    this.dir = app.getPath("userData");
    fs.mkdirSync(this.dir, { recursive: true });
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...this.readJson<Partial<StoredSettings>>("settings.json", {}),
    };
    // Installs that pointed a custom command at CodeBuddy get the first-class
    // provider, so the UI names the mind instead of showing "custom-cli" and the
    // model field reflects the model the command actually passes.
    if (this.settings.provider === "custom-cli" && /codebuddy/i.test(this.settings.cliCommand ?? "")) {
      this.settings.provider = "codebuddy";
      const model = this.settings.cliCommand.match(/--model\s+([^\s]+)/)?.[1];
      if (model) this.settings.model = model;
      this.writeJson("settings.json", this.settings);
    }
    this.agents = this.readJson<AgentRecord[]>("world.json", []).map(normaliseAgent);
    this.thread = this.readJson<ChatMessage[]>("threads/main.json", []);
    this.memories = this.readJson<MemoryEntry[]>("memory.json", []);
    this.documents = this.readJson<DocumentRecord[]>("documents.json", []);
    this.sessions = this.readJson<SessionRecord[]>("sessions.json", []);
    this.usage = {
      ...this.usage,
      ...this.readJson<Partial<UsageRecord>>("usage.json", {}),
    };
    this.runs = this.readJson<RunRecord[]>("runs.json", []);
    this.skills = this.readJson<SkillRecord[]>("skills.json", []).map(normaliseSkill);
    this.workflows = this.readJson<WorkflowRecord[]>("workflows.json", []);
    this.packs = this.readJson<ContextPack[]>("packs.json", []);
    this.attachedPack = this.readJson<string | null>("attached-pack.json", null);
    this.routines = this.readJson<RoutineRecord[]>("routines.json", []).map(normaliseRoutine);
    this.feedback = this.readJson<FeedbackRecord[]>("feedback.json", []);

    // Older builds posted worker answers into the orchestrator's thread. Those
    // rows have no owner and a tell-tale prefix; they belong to the worker, so
    // drop them from the conversation they were never part of.
    const beforeMigration = this.thread.length;
    this.thread = this.thread.filter((m) => m.agentId || !/reported back:/i.test(m.content));
    // Older answers carry the run-together sentence and the “I'll look…”
    // preamble that the current tidy pass removes. Clean history on read rather
    // than leaving a permanent example of the behaviour the person disliked.
    let tidied = false;
    this.thread = this.thread.map((message) => {
      if (message.role !== "assistant") return message;
      const clean = tidyAnswer(message.content);
      if (clean === message.content) return message;
      tidied = true;
      return { ...message, content: clean };
    });
    if (this.thread.length !== beforeMigration || tidied) this.writeJson("threads/main.json", this.thread);

    // A bot is one task's body, not a resident. Their conversations stay in the
    // thread, but a fresh launch should not open with yesterday's workers.
    if (this.agents.some((a) => a.agentType === "bot")) {
      this.agents = this.agents.filter((a) => a.agentType !== "bot");
      this.writeJson("world.json", this.agents);
    }

    // One companion. The world opens on a single orchestrator and every other
    // body is summoned by it, so seeding three workers up front puts two orbs in a
    // world that should have one.
    const seeded = new Set(["Wren", "Atlas", "Juno"]);
    const extras = this.agents.filter((a) => seeded.has(a.name)).length;
    if (this.agents.length === 0) {
      this.agents = [seedAgent("Wren", 0)];
      this.writeJson("world.json", this.agents);
    } else if (this.agents.length > 1 && extras === this.agents.length) {
      // Existing installs still carry the old three-worker seed. Only prune when
      // *every* agent is one of those untouched seeds, so a world you built up
      // yourself is never trimmed.
      this.agents = [this.agents[0]];
      this.writeJson("world.json", this.agents);
    }

    // The old in-world "Summon" demo saved specialist workers as if they were
    // companions. A world opens on one body and only stands a worker while a
    // delegation runs, so drop those leftovers; real workers are spawned and
    // killed by `delegate_task`, never saved for good.
    if (this.agents.length > 1) {
      const workers = this.agents.filter((a) =>
        String(a.persona ?? "").startsWith("You are a specialist worker in this world."),
      );
      if (workers.length > 0 && workers.length < this.agents.length) {
        this.agents = this.agents.filter((a) => !workers.includes(a));
        this.writeJson("world.json", this.agents);
      }
    }
  }

  private file(name: string) {
    return path.join(this.dir, name);
  }

  private readJson<T>(name: string, fallback: T): T {
    try {
      const raw = fs.readFileSync(this.file(name), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(name: string, value: unknown) {
    const target = this.file(name);
    // `threads/` is a subfolder and is not created by the data-dir mkdir, so a
    // first message used to fail with ENOENT on the temp file.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, target);
  }

  // ---- settings -----------------------------------------------------------

  getSettings(): Settings {
    const { keyEnc: _keyEnc, voiceKeyEnc: _voiceEnc, ...rest } = this.settings;
    return {
      ...rest,
      actions: rest.actions ?? "ask",
      abilities: rest.abilities
        ? { ...rest.abilities, screen: rest.abilities.screen ?? false, hands: rest.abilities.hands ?? false }
        : undefined,
      learning: rest.learning ?? { memory: true, skills: true },
      notifyOs: rest.notifyOs ?? false,
      hasKey: Boolean(this.settings.keyEnc),
      hasVoiceKey: Boolean(this.settings.voiceKeyEnc || process.env.ELEVENLABS_API_KEY),
      voiceId: this.settings.voiceId ?? "",
    };
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.writeJson("settings.json", this.settings);
    return this.getSettings();
  }

  setApiKey(key: string): Settings {
    const trimmed = key.trim();
    if (!trimmed) {
      delete this.settings.keyEnc;
    } else if (safeStorage.isEncryptionAvailable()) {
      this.settings.keyEnc = safeStorage.encryptString(trimmed).toString("base64");
    } else {
      // No OS keychain (rare on Windows/Linux without a session keyring). We refuse
      // rather than writing a plaintext secret to disk.
      throw new Error(
        "The OS keychain is unavailable, so the key was not saved. Set it in your environment instead.",
      );
    }
    this.writeJson("settings.json", this.settings);
    return this.getSettings();
  }

  getApiKey(): string {
    if (!this.settings.keyEnc) return process.env.VIV_API_KEY ?? "";
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.keyEnc, "base64"));
    } catch {
      return process.env.VIV_API_KEY ?? "";
    }
  }

  // ---- voice (ElevenLabs) -------------------------------------------------

  setVoiceKey(key: string): Settings {
    const trimmed = key.trim();
    if (!trimmed) {
      delete this.settings.voiceKeyEnc;
    } else if (safeStorage.isEncryptionAvailable()) {
      this.settings.voiceKeyEnc = safeStorage.encryptString(trimmed).toString("base64");
    } else {
      throw new Error(
        "The OS keychain is unavailable, so the voice key was not saved. Set ELEVENLABS_API_KEY in the environment instead.",
      );
    }
    this.writeJson("settings.json", this.settings);
    return this.getSettings();
  }

  /** Main-process only. The renderer never receives this value. */
  getVoiceKey(): string {
    if (!this.settings.voiceKeyEnc) return process.env.ELEVENLABS_API_KEY ?? "";
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.voiceKeyEnc, "base64"));
    } catch {
      return process.env.ELEVENLABS_API_KEY ?? "";
    }
  }

  hasVoiceKey(): boolean {
    return Boolean(this.settings.voiceKeyEnc || process.env.ELEVENLABS_API_KEY);
  }

  voiceKeySource(): "keychain" | "environment" | "none" {
    if (this.settings.voiceKeyEnc) return "keychain";
    if (process.env.ELEVENLABS_API_KEY) return "environment";
    return "none";
  }

  // ---- agents -------------------------------------------------------------

  listAgents(): AgentRecord[] {
    return this.agents;
  }

  agent(id: string): AgentRecord | undefined {
    return this.agents.find((a) => a.id === id);
  }

  saveAgents(agents: AgentRecord[]): AgentRecord[] {
    this.agents = agents.map(normaliseAgent);
    this.writeJson("world.json", this.agents);
    return this.agents;
  }

  /** Create or replace one record without touching the rest. */
  upsertAgent(agent: AgentRecord): AgentRecord {
    const clean = normaliseAgent(agent);
    const index = this.agents.findIndex((a) => a.id === clean.id);
    if (index >= 0) this.agents[index] = clean;
    else this.agents.push(clean);
    this.writeJson("world.json", this.agents);
    return clean;
  }

  removeAgent(id: string): AgentRecord[] {
    this.agents = this.agents.filter((a) => a.id !== id);
    this.sessions = this.sessions.filter((s) => s.agentId !== id);
    this.writeJson("world.json", this.agents);
    this.writeJson("sessions.json", this.sessions);
    return this.agents;
  }

  setAgentState(id: string, state: AgentRecord["state"]) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return;
    a.state = state;
    this.writeJson("world.json", this.agents);
  }

  // ---- sessions -----------------------------------------------------------

  agentsWithSessions(): SessionRecord[] {
    return this.sessions;
  }

  saveSession(session: SessionRecord): SessionRecord {
    const index = this.sessions.findIndex((s) => s.agentId === session.agentId);
    if (index >= 0) this.sessions[index] = session;
    else this.sessions.push(session);
    this.writeJson("sessions.json", this.sessions);
    return session;
  }

  /** Reference `kill_session`. Releases the allocation, never the agent. */
  killSession(agentId: string): boolean {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.agentId !== agentId);
    this.writeJson("sessions.json", this.sessions);
    return this.sessions.length !== before;
  }

  // ---- thread -------------------------------------------------------------

  /**
   * One agent's conversation. Rows from before the split have no owner and are
   * shown with the orchestrator, so an older install opens where it left off.
   */
  history(agentId?: string): ChatMessage[] {
    if (!agentId) return this.thread;
    const owner = (this.agents.find((a) => a.isOrchestrator) ?? this.agents[0])?.id;
    return this.thread.filter((m) => m.agentId === agentId || (!m.agentId && agentId === owner));
  }

  push(message: ChatMessage) {
    this.thread.push(message);
    if (this.thread.length > 400) this.thread = this.thread.slice(-400);
    this.writeJson("threads/main.json", this.thread);
  }

  clearThread() {
    this.thread = [];
    this.writeJson("threads/main.json", this.thread);
  }

  // ---- memory -------------------------------------------------------------

  listMemory(): MemoryEntry[] {
    return this.memories;
  }

  addMemory(text: string, source = "chat"): MemoryEntry[] {
    const clean = text.trim();
    if (!clean) return this.memories;
    this.memories.push({ id: crypto.randomUUID(), text: clean.slice(0, 2000), at: Date.now(), source });
    this.writeJson("memory.json", this.memories);
    return this.memories;
  }

  updateMemory(id: string, text: string): MemoryEntry[] {
    const clean = text.trim();
    if (!clean) return this.memories;
    this.memories = this.memories.map((m) =>
      m.id === id ? { ...m, text: clean.slice(0, 2000), at: Date.now() } : m,
    );
    this.writeJson("memory.json", this.memories);
    return this.memories;
  }

  /**
   * A fact the learning pass kept. If she already knew a version of the same
   * thing (“the accent is ember” → “the accent is green”), the newer sentence
   * replaces the older one instead of piling up contradictions.
   */
  learnFact(text: string): { added: boolean; entry: MemoryEntry } | null {
    const clean = text.trim().replace(/^[-•]\s*/, "").slice(0, 800);
    if (clean.length < 8) return null;
    const key = memoryKey(clean);
    const same = this.memories.find((m) => memoryKey(m.text) === key);
    if (same) {
      if (same.text.toLowerCase() === clean.toLowerCase()) return { added: false, entry: same };
      same.text = clean;
      same.at = Date.now();
      same.source = "learned";
      this.writeJson("memory.json", this.memories);
      return { added: true, entry: same };
    }
    if (this.memories.some((m) => m.text.toLowerCase() === clean.toLowerCase())) {
      return { added: false, entry: this.memories.find((m) => m.text.toLowerCase() === clean.toLowerCase())! };
    }
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text: clean,
      at: Date.now(),
      source: "learned",
    };
    this.memories.push(entry);
    // A person's facts are the most valuable rows she has; keep a generous cap
    // and let the oldest go rather than growing the prompt forever.
    if (this.memories.length > 400) this.memories = this.memories.slice(-400);
    this.writeJson("memory.json", this.memories);
    return { added: true, entry };
  }

  forgetMemory(id: string): MemoryEntry[] {
    this.memories = this.memories.filter((m) => m.id !== id);
    this.writeJson("memory.json", this.memories);
    return this.memories;
  }

  recall(query: string, limit = 6): MemoryEntry[] {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (words.length === 0) return this.memories.slice(-limit);
    return this.memories
      .map((m) => {
        const hay = m.text.toLowerCase();
        const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.at - a.m.at)
      .slice(0, limit)
      .map((x) => x.m);
  }

  // ---- skills (procedures she can reuse) ----------------------------------

  listSkills(): SkillRecord[] {
    return [...this.skills].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Save a skill. A learned skill that already has a name bumps the existing
   * one instead of creating a near-duplicate every time the same job comes up.
   */
  saveSkill(input: Partial<SkillRecord> & { name: string }): SkillRecord {
    const name = input.name.trim().slice(0, 80) || "Untitled skill";
    const existing = this.skills.find(
      (s) => s.id === input.id || (!input.id && s.name.toLowerCase() === name.toLowerCase()),
    );
    const now = Date.now();
    const record: SkillRecord = normaliseSkill({
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      name,
      description: input.description ?? existing?.description ?? "",
      instructions: input.instructions ?? existing?.instructions ?? "",
      docs: input.docs ?? existing?.docs ?? [],
      integrations: input.integrations ?? existing?.integrations ?? [],
      source: input.source ?? existing?.source ?? "manual",
      uses: input.uses ?? existing?.uses ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const index = this.skills.findIndex((s) => s.id === record.id);
    if (index >= 0) this.skills[index] = record;
    else this.skills.push(record);
    if (this.skills.length > 200) this.skills = this.skills.slice(-200);
    this.writeJson("skills.json", this.skills);
    return record;
  }

  removeSkill(id: string): SkillRecord[] {
    this.skills = this.skills.filter((s) => s.id !== id);
    this.writeJson("skills.json", this.skills);
    return this.listSkills();
  }

  bumpSkill(id: string) {
    const skill = this.skills.find((s) => s.id === id);
    if (!skill) return;
    skill.uses += 1;
    skill.updatedAt = Date.now();
    this.writeJson("skills.json", this.skills);
  }

  // ---- feedback (the person's verdict on an answer) ------------------------

  listFeedback(): FeedbackRecord[] {
    return this.feedback;
  }

  /**
   * A thumb is evidence, not decoration. It lands on the run, in its own log,
   * and on the workflow row that chose the approach: a down-vote makes that
   * approach one attempt less attractive next time, which is how the choice
   * gets better without anyone editing a rule.
   */
  rateFeedback(runId: string, value: "up" | "down" | null): RunRecord[] {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error("That answer is no longer in the ledger.");
    const previous = run.feedback;
    const next = value ?? undefined;

    if (previous !== next) {
      const workflow = run.workflowId
        ? this.workflows.find((w) => w.id === run.workflowId)
        : undefined;
      if (workflow) {
        if (!previous && next) {
          workflow.attempts += 1;
          if (next === "up") workflow.successes += 1;
        } else if (previous && !next) {
          workflow.attempts = Math.max(1, workflow.attempts - 1);
          if (previous === "up") workflow.successes = Math.max(0, workflow.successes - 1);
        } else if (previous === "up" && next === "down") {
          workflow.successes = Math.max(0, workflow.successes - 1);
        } else if (previous === "down" && next === "up") {
          workflow.successes += 1;
        }
        this.writeJson("workflows.json", this.workflows);
      }
      this.feedback = this.feedback.filter((f) => f.runId !== runId);
      if (next) {
        this.feedback.push({
          runId,
          agentId: run.agentId,
          value: next,
          at: Date.now(),
          ...(run.workflowId ? { workflowId: run.workflowId } : {}),
        });
      }
      if (next) run.feedback = next;
      else delete run.feedback;
      this.writeJson("feedback.json", this.feedback);
      this.writeJson("runs.json", this.runs);
    }
    return [...this.runs].sort((a, b) => b.startedAt - a.startedAt);
  }

  // ---- routines (things she does later, on a clock) -----------------------

  listRoutines(): RoutineRecord[] {
    return [...this.routines].sort((a, b) => a.nextAt - b.nextAt);
  }

  routine(id: string): RoutineRecord | undefined {
    return this.routines.find((r) => r.id === id);
  }

  saveRoutine(
    input: Partial<RoutineRecord> & {
      name: string;
      prompt: string;
      schedule: RoutineSchedule;
      kind?: "reminder" | "routine";
    },
  ): RoutineRecord {
    const existing = input.id ? this.routines.find((r) => r.id === input.id) : undefined;
    const schedule = input.schedule ?? existing?.schedule ?? { kind: "daily", time: "09:00" };
    const record = normaliseRoutine({
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      name: input.name.trim().slice(0, 80) || "Untitled reminder",
      kind: input.kind ?? existing?.kind ?? "reminder",
      schedule,
      createdAt: existing?.createdAt ?? Date.now(),
      // Saving is the moment a schedule starts counting from.
      nextAt: nextRunAt(schedule),
      enabled: input.enabled ?? existing?.enabled ?? true,
      runs: existing?.runs ?? [],
    });
    const index = this.routines.findIndex((r) => r.id === record.id);
    if (index >= 0) this.routines[index] = record;
    else this.routines.push(record);
    if (this.routines.length > 500) this.routines = this.routines.slice(-500);
    this.writeJson("routines.json", this.routines);
    return record;
  }

  removeRoutine(id: string): RoutineRecord[] {
    this.routines = this.routines.filter((r) => r.id !== id);
    this.writeJson("routines.json", this.routines);
    return this.listRoutines();
  }

  /** Record a firing and roll the schedule forward (or switch a one-off off). */
  noteRoutineRun(id: string, run: RoutineRun): RoutineRecord | undefined {
    const routine = this.routines.find((r) => r.id === id);
    if (!routine) return undefined;
    routine.runs = [run, ...routine.runs].slice(0, 40);
    routine.lastAt = run.at;
    if (routine.schedule.kind === "once") {
      routine.enabled = false;
    } else {
      routine.nextAt = nextRunAt(routine.schedule, Date.now() + 1000);
    }
    this.writeJson("routines.json", this.routines);
    return routine;
  }

  // ---- documents (local knowledge stand-in) -------------------------------

  listDocuments(): DocumentRecord[] {
    return this.documents;
  }

  addDocument(input: {
    title?: string;
    body: string;
    agentId?: string;
    tags?: string[];
  }): DocumentRecord {
    const record: DocumentRecord = {
      id: crypto.randomUUID(),
      title: (input.title ?? input.body.split(/\n/)[0] ?? "Untitled").slice(0, 120),
      body: input.body.slice(0, 100_000),
      at: Date.now(),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      tags: (input.tags ?? []).slice(0, 12),
    };
    this.documents.push(record);
    if (this.documents.length > 1000) this.documents = this.documents.slice(-1000);
    this.writeJson("documents.json", this.documents);
    return record;
  }

  searchDocuments(query: string, limit = 6): DocumentRecord[] {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.length === 0) return this.documents.slice(-limit);
    return this.documents
      .map((d) => {
        const hay = `${d.title} ${d.tags.join(" ")} ${d.body}`.toLowerCase();
        return { d, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.d.at - a.d.at)
      .slice(0, limit)
      .map((x) => x.d);
  }

  // ---- context packs ------------------------------------------------------

  listPacks(): ContextPack[] {
    return this.packs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  savePack(input: Partial<ContextPack> & { name: string }): ContextPack[] {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("A pack needs a name.");
    const existing = input.id ? this.packs.find((p) => p.id === input.id) : undefined;
    const record: ContextPack = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      description: String(input.description ?? existing?.description ?? "").slice(0, 400),
      body: String(input.body ?? existing?.body ?? "").slice(0, 200_000),
      at: existing?.at ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.packs = existing ? this.packs.map((p) => (p.id === existing.id ? record : p)) : [...this.packs, record];
    this.writeJson("packs.json", this.packs);
    return this.listPacks();
  }

  removePack(id: string): ContextPack[] {
    this.packs = this.packs.filter((p) => p.id !== id);
    if (this.attachedPack === id) this.attachPack(null);
    this.writeJson("packs.json", this.packs);
    return this.listPacks();
  }

  attachPack(id: string | null): string | null {
    const valid = id && this.packs.some((p) => p.id === id) ? id : null;
    this.attachedPack = valid;
    this.writeJson("attached-pack.json", valid);
    return valid;
  }

  getAttachedPack(): ContextPack | null {
    if (!this.attachedPack) return null;
    return this.packs.find((p) => p.id === this.attachedPack) ?? null;
  }

  // ---- usage / runs -------------------------------------------------------

  getUsage(): UsageRecord {
    return this.usage;
  }

  recordUsage(input: { inputChars: number; outputChars: number; toolCalls: number }) {
    const inputChars = Math.max(0, Math.round(input.inputChars));
    const outputChars = Math.max(0, Math.round(input.outputChars));
    this.usage = {
      runs: this.usage.runs + 1,
      toolCalls: this.usage.toolCalls + Math.max(0, input.toolCalls),
      inputChars: this.usage.inputChars + inputChars,
      outputChars: this.usage.outputChars + outputChars,
      // Rough and deliberately local: 4 characters ≈ 1 token. Never used for billing.
      estTokens: this.usage.estTokens + Math.round((inputChars + outputChars) / 4),
      updatedAt: Date.now(),
    };
    this.writeJson("usage.json", this.usage);
    return this.usage;
  }

  recordRun(run: RunRecord) {
    const index = this.runs.findIndex((r) => r.id === run.id);
    if (index >= 0) this.runs[index] = run;
    else this.runs.push(run);
    if (this.runs.length > 500) this.runs = this.runs.slice(-500);
    this.writeJson("runs.json", this.runs);
  }

  listRuns(): RunRecord[] {
    return this.runs;
  }

  // ---- mined workflows ----------------------------------------------------

  listWorkflows(): WorkflowRecord[] {
    return [...this.workflows].sort(
      (a, b) => b.successes / Math.max(1, b.attempts) - a.successes / Math.max(1, a.attempts) || b.attempts - a.attempts,
    );
  }

  /**
   * Add one outcome to the route the run actually took. Similar task shapes,
   * strategies, minds and tools share one row so a winner accumulates evidence
   * instead of spawning a new line every time the wording changes.
   */
  recordWorkflow(input: {
    task: string;
    keywords: string[];
    strategy: WorkflowRecord["strategy"];
    tools: string[];
    provider: string;
    model: string;
    ok: boolean;
    ms: number;
    existingId?: string;
  }): WorkflowRecord {
    const current = new Set(input.keywords);
    const existing =
      this.workflows.find((w) => w.id === input.existingId) ??
      this.workflows.find(
        (w) =>
          w.strategy === input.strategy &&
          w.provider === input.provider &&
          w.model === input.model &&
          w.keywords.filter((word) => current.has(word)).length >= 3,
      );
    const now = Date.now();
    if (existing) {
      existing.attempts += 1;
      if (input.ok) existing.successes += 1;
      existing.totalMs += Math.max(0, input.ms);
      existing.lastAt = now;
      existing.tools = [...new Set([...existing.tools, ...input.tools])].slice(0, 12);
      existing.keywords = [...new Set([...existing.keywords, ...input.keywords])].slice(0, 16);
      this.writeJson("workflows.json", this.workflows);
      return existing;
    }
    const record: WorkflowRecord = {
      id: crypto.randomUUID(),
      task: input.task.slice(0, 120),
      keywords: input.keywords.slice(0, 16),
      strategy: input.strategy,
      tools: [...new Set(input.tools)].slice(0, 12),
      provider: input.provider,
      model: input.model,
      attempts: 1,
      successes: input.ok ? 1 : 0,
      totalMs: Math.max(0, input.ms),
      lastAt: now,
    };
    this.workflows.push(record);
    // Keep the ledger useful, not endless: strongest records first.
    this.workflows = this.listWorkflows().slice(0, 400);
    this.writeJson("workflows.json", this.workflows);
    return record;
  }

  /** The Usage pane reads this: real counters from this machine. */
  usageReport() {
    return {
      usage: this.usage,
      runs: [...this.runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30),
      memories: this.memories.length,
      skills: this.skills.length,
      workflows: this.listWorkflows().slice(0, 24),
      feedback: [...this.feedback].sort((a, b) => b.at - a.at).slice(0, 200),
      firstAt: this.runs[0]?.startedAt ?? this.usage.updatedAt,
    };
  }

  // ---- audit --------------------------------------------------------------

  audit(entry: AuditEntry) {
    fs.appendFileSync(this.file("audit.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  }

  listAudit(limit = 200): AuditEntry[] {
    try {
      const raw = fs.readFileSync(this.file("audit.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l) as AuditEntry)
        .reverse();
    } catch {
      return [];
    }
  }

  // ---- reset --------------------------------------------------------------

  /**
   * Settings → Advanced → Reset local state. Everything this app wrote goes:
   * companions are reseeded, memory/skills/documents/threads/usage/ledger are
   * emptied, and settings return to their defaults. Only the app itself stays.
   */
  resetLocalState(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.agents = [seedAgent("Wren", 0)];
    this.thread = [];
    this.memories = [];
    this.skills = [];
    this.documents = [];
    this.sessions = [];
    this.runs = [];
    this.workflows = [];
    this.packs = [];
    this.attachedPack = null;
    this.routines = [];
    this.feedback = [];
    this.usage = {
      runs: 0,
      toolCalls: 0,
      inputChars: 0,
      outputChars: 0,
      estTokens: 0,
      updatedAt: 0,
    };
    this.writeJson("settings.json", this.settings);
    this.writeJson("world.json", this.agents);
    this.writeJson("threads/main.json", this.thread);
    this.writeJson("memory.json", this.memories);
    this.writeJson("skills.json", this.skills);
    this.writeJson("documents.json", this.documents);
    this.writeJson("sessions.json", this.sessions);
    this.writeJson("runs.json", this.runs);
    this.writeJson("workflows.json", this.workflows);
    this.writeJson("packs.json", this.packs);
    this.writeJson("attached-pack.json", this.attachedPack);
    this.writeJson("routines.json", this.routines);
    this.writeJson("feedback.json", this.feedback);
    this.writeJson("usage.json", this.usage);
    try {
      fs.writeFileSync(this.file("audit.jsonl"), "", "utf8");
    } catch {
      // a read-only ledger is already gone enough
    }
  }

  // ---- export -------------------------------------------------------------

  exportAll(): string | null {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      agents: this.agents,
      sessions: this.sessions,
      thread: this.thread,
      memory: this.memories,
      skills: this.skills,
      documents: this.documents,
      usage: this.usage,
      runs: this.runs,
      workflows: this.workflows,
      packs: this.packs,
      routines: this.routines,
      feedback: this.feedback,
      vault: this.readJson<unknown>("vault.json", null),
      audit: this.listAudit(5000),
    };
    const target = path.join(
      app.getPath("downloads"),
      `vivarium-export-${new Date().toISOString().slice(0, 10)}.json`,
    );
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
    return target;
  }
}

/** Fill the optional identity fields so every record has the same shape. */
function normaliseRoutine(routine: RoutineRecord): RoutineRecord {
  const schedule: RoutineSchedule =
    routine.schedule && typeof routine.schedule === "object" && "kind" in routine.schedule
      ? routine.schedule
      : { kind: "daily", time: "09:00" };
  return {
    id: routine.id || crypto.randomUUID(),
    name: String(routine.name ?? "Untitled reminder").trim().slice(0, 80) || "Untitled reminder",
    kind: routine.kind === "routine" ? "routine" : "reminder",
    prompt: String(routine.prompt ?? "").slice(0, 8000),
    schedule,
    enabled: routine.enabled !== false,
    agentId: routine.agentId,
    createdAt: Number.isFinite(routine.createdAt) ? routine.createdAt : Date.now(),
    nextAt: Number.isFinite(routine.nextAt) ? routine.nextAt : nextRunAt(schedule),
    lastAt: Number.isFinite(routine.lastAt) ? routine.lastAt : undefined,
    runs: Array.isArray(routine.runs) ? routine.runs.slice(0, 40) : [],
  };
}

export function normaliseAgent(agent: AgentRecord): AgentRecord {
  const hue = Number.isFinite(agent.hue) ? ((agent.hue % 360) + 360) % 360 : 200;
  const id = agent.id || crypto.randomUUID();
  return {
    id,
    name: agent.name?.trim() || "Unnamed",
    persona: agent.persona?.trim() || "You are a worker in this world. Report results plainly.",
    hue,
    state: agent.state ?? "idle",
    position: Array.isArray(agent.position) && agent.position.length === 3
      ? [Number(agent.position[0]) || 0, Number(agent.position[1]) || 0, Number(agent.position[2]) || 0]
      : [0, 0, 0],
    role: agent.role ?? (agent.isOrchestrator || agent.agentType === "orchestrator" ? "orchestrator" : "companion"),
    agentType: agent.agentType ?? (agent.isOrchestrator ? "orchestrator" : "companion"),
    systemPrompt: agent.systemPrompt ?? agent.persona,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.tools ? { tools: [...new Set(agent.tools)] } : {}),
    approval: agent.approval ?? "manual",
    color: agent.color ?? hueColor(hue),
    ...(agent.parentId ? { parentId: agent.parentId } : {}),
    isOrchestrator: Boolean(agent.isOrchestrator ?? agent.agentType === "orchestrator"),
    ...(agent.alwaysAllow?.length ? { alwaysAllow: [...new Set(agent.alwaysAllow)] } : {}),
    createdAt: agent.createdAt ?? Date.now(),
  };
}

/**
 * The identity of a fact, so an update replaces the older sentence instead of
 * contradicting it. Names get their own key ("my name is Sam" then "my name is
 * Samuel" is the same slot); everything else is identified by its first four
 * words, which is enough for "the accent is ember" and "the user's editor is
 * Neovim" to stay distinct.
 */
function memoryKey(text: string): string {
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  if (/\b(?:my name is|call me|the user s name is|the users name is)\b/.test(clean)) {
    return "identity:name";
  }
  const favourite = clean.match(/my (?:favourite|favorite|preferred) (\w+)/);
  if (favourite) return `favourite:${favourite[1]}`;
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

function normaliseSkill(skill: SkillRecord): SkillRecord {
  return {
    id: skill.id || crypto.randomUUID(),
    name: String(skill.name ?? "Untitled skill").trim().slice(0, 80) || "Untitled skill",
    description: String(skill.description ?? "").slice(0, 600),
    instructions: String(skill.instructions ?? "").slice(0, 12_000),
    docs: Array.isArray(skill.docs) ? skill.docs.slice(0, 40) : [],
    integrations: Array.isArray(skill.integrations) ? skill.integrations.slice(0, 40) : [],
    source: skill.source === "learned" ? "learned" : "manual",
    uses: Number.isFinite(skill.uses) ? Math.max(0, Math.round(skill.uses)) : 0,
    createdAt: Number.isFinite(skill.createdAt) ? skill.createdAt : Date.now(),
    updatedAt: Number.isFinite(skill.updatedAt) ? skill.updatedAt : Date.now(),
  };
}

export function hueColor(hue: number): string {
  return `hsl(${Math.round(((hue % 360) + 360) % 360)} 78% 58%)`;
}

function seedAgent(name: string, i: number): AgentRecord {
  const angle = (i / 3) * Math.PI * 2;
  return normaliseAgent({
    id: crypto.randomUUID(),
    name,
    persona:
      i === 0
        ? "You are the guide of this world. Warm, concise, practical. You have hands on this machine through tools; use them when asked, and say what you are about to do first."
        : `You are ${name}, a specialist worker in this world. Stay focused, report results plainly.`,
    hue: [168, 262, 34][i] ?? 200,
    state: "idle",
    position: [Math.cos(angle) * 3.2, (i - 1) * 0.6, Math.sin(angle) * 3.2],
    role: i === 0 ? "orchestrator" : "companion",
    agentType: i === 0 ? "orchestrator" : "companion",
    isOrchestrator: i === 0,
  });
}
