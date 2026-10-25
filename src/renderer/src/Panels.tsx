import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentRecord,
  AuditEntry,
  ContextPack,
  MemoryEntry,
  ScreenPreview,
  Settings,
  UsageReport,
  VaultDocument,
  VaultHit,
} from "../../shared/types";
import { Icon, type IconName } from "./shell/icons";
import { resetDb } from "./shell/data";
import { resetPrefs, usePrefs, type Prefs } from "./shell/prefs";
import { pushToast } from "./shell/toasts";
import {
  Chip,
  Confirm,
  ErrorBlock,
  Field,
  LoadingRows,
  Menu,
  MenuRow,
  Modal,
  ProgressRule,
  RadioCards,
  Range,
  Row,
  SectionLabel,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "./shell/ui";

/** Every helper string in one place, so the inventory can be checked against the build. */
export const HELP = {
  startView: "Where the app opens.",
  locale: "Date and number formatting only.",
  timezone: "Automations run in this zone.",
  currency: "Used on credits and invoices.",
  renderQuality: "Resolution of the sea and dust.",
  bloom: "The warm edge glow around the orb.",
  ambientDrift: "Slow camera drift when idle.",
  reduceMotion: "Stops movement; keeps fades.",
  companionName: "How she signs her messages.",
  companionHue: "The colour of her orb and card.",
  voice: "Speech voice for spoken replies.",
  goal: "What you're working on right now.",
  interview: "Nothing from the interview yet.",
  provider: "Where the thinking happens.",
  model: "The model id the provider expects.",
  baseUrl: "OpenAI-compatible base, ending in /v1.",
  apiKey: "Encrypted with the OS keychain.",
  cliCommand: "Use {prompt} where the prompt goes.",
  temperature: "Lower is steadier, higher is looser.",
  maxTokens: "Cap on one reply, not the thread.",
  streaming: "Print tokens as they arrive.",
  preamble: "Prepended to every conversation.",
  roots: "Folders the agents may read and write.",
  outsideRoots: "Read anywhere on this machine.",
  allowWrite: "Create and overwrite files in roots.",
  allowShell: "Run commands with your user rights.",
  allowNetwork: "Reach the web and your APIs.",
  allowlist: "Tools that skip the ask.",
  accent: "The world's single warm accent.",
  seaTheme: "Sea colour ramp and fog.",
  bloomStrength: "0 to 1. Higher blooms more.",
  fogDensity: "How fast the horizon disappears.",
  grid: "Faint floor lines under the orbs.",
  cameraDrift: "How far the camera leans.",
  autosave: "Save after you stop typing.",
  defaultFolder: "Where new entries land.",
  sortOrder: "Drag order or A–Z.",
  exportDocs: "One .md file per entry.",
  workspace: "The root working directory for sessions.",
  extraFolders: "Folders granted one session at a time.",
  notifInApp: "Toasts and the activity list.",
  notifDevices: "A native notification from this computer when the window is in the background.",
  notifFinish: "A note when work finishes.",
  lowCredits: "Warn before credits run out.",
  lowCreditAt: "Credits left when the warning fires.",
  emailSummary: "One email while you were away.",
  emailFrequency: "How often the digest goes out.",
  telegram: "Reach her from your phone.",
  tier: "No cloud plan in this build.",
  pack: "Every pack grows with its size.",
  customAmount: "Enter a dollar amount, like 25 or 25.50.",
  savedCard: "Saved cards live with the provider.",
  renewal: "Next renewal date.",
  accessibility: "Reading windows.",
  screenRecording: "Reading the screen.",
  appAccess: "Apps companions may look at.",
  accountName: "Shown on the avatar and invites.",
  accountEmail: "Used for receipts only.",
  organization: "Group billing and shared folders.",
  inviteLink: "Anyone with this link can join.",
  dataDir: "Where the JSON lives.",
  retention: "How long tool runs are kept.",
  diagnostics: "Copy the last 200 lines.",
  reset: "Deletes agents, memory and settings.",
} as const;

export interface SectionProps {
  settings: Settings;
  patch: (next: Partial<Settings>) => void;
  compact?: boolean;
  info: { version: string; platform: string; dataDir: string } | null;
  agentName: string;
  onRenameAgent: (name: string) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}

export const SECTIONS: { id: string; title: string; icon: IconName; blurb: string }[] = [
  { id: "prefs", title: "Preferences", icon: "spark", blurb: "Look, language, start view" },
  { id: "companion", title: "Companion", icon: "user", blurb: "Identity, personality, tone" },
  { id: "mind", title: "Mind", icon: "brain", blurb: "Provider, model, key, temperature" },
  { id: "hands", title: "Hands", icon: "hand", blurb: "Roots, permissions, approvals" },
  { id: "world", title: "World", icon: "target", blurb: "Accent, motion, quality" },
  { id: "documents", title: "Documents", icon: "doc", blurb: "Autosave, folders, export" },
  { id: "files", title: "Files & access", icon: "folder", blurb: "Workspace root and extra folders" },
  { id: "notif", title: "Notifications", icon: "bell", blurb: "In-app, native, work finishing" },
  { id: "billing", title: "Usage & ledger", icon: "trend", blurb: "Runs, tools, every entry" },
  { id: "machine", title: "Machine", icon: "screen", blurb: "Screen, folders, log" },
  { id: "account", title: "Account", icon: "shield", blurb: "Profile, usage, device" },
  { id: "advanced", title: "Advanced", icon: "cpu", blurb: "Data, retention, reset" },
];

function Head({ title, blurb }: { title: string; blurb: string }) {
  return (
    <header className="pane-head">
      <h2>{title}</h2>
      <p>{blurb}</p>
    </header>
  );
}

/* ------------------------------------------------------------------ preferences */

export function PreferencesSection({ settings, patch }: SectionProps) {
  const [prefs, set] = usePrefs();
  return (
    <>
      <Head title="Preferences" blurb="How the app looks and where it starts." />
      <SectionLabel>General</SectionLabel>
      <Row label="Start view" help={HELP.startView}>
        <Select
          value={prefs.startView}
          onChange={(v) => set({ startView: v })}
          ariaLabel="Start view"
          options={[
            { value: "world", label: "World" },
            { value: "documents", label: "Documents" },
            { value: "configure", label: "Configure" },
          ]}
        />
      </Row>
      <Row label="Locale" help={HELP.locale}>
        <Select
          value={prefs.locale}
          onChange={(v) => set({ locale: v })}
          ariaLabel="Locale"
          options={[
            { value: "en-GB", label: "English (UK)" },
            { value: "en-US", label: "English (US)" },
            { value: "de-DE", label: "Deutsch" },
            { value: "fr-FR", label: "Français" },
            { value: "ja-JP", label: "日本語" },
          ]}
        />
      </Row>
      <Row label="Timezone" help={HELP.timezone}>
        <TextInput value={prefs.timezone} onChange={(v) => set({ timezone: v })} mono />
      </Row>
      <Row label="Currency" help={HELP.currency}>
        <Select
          value={prefs.currency}
          onChange={(v) => set({ currency: v })}
          ariaLabel="Currency"
          options={[
            { value: "USD", label: "USD" },
            { value: "GBP", label: "GBP" },
            { value: "EUR", label: "EUR" },
          ]}
        />
      </Row>
      <SectionLabel>Render</SectionLabel>
      <Row label="Render quality" help={HELP.renderQuality}>
        <Select
          value={prefs.renderQuality}
          onChange={(v) => set({ renderQuality: v })}
          ariaLabel="Render quality"
          options={[
            { value: "low", label: "Low" },
            { value: "balanced", label: "Balanced" },
            { value: "high", label: "High" },
          ]}
        />
      </Row>
      <Row label="Bloom" help={HELP.bloom}>
        <Toggle on={prefs.bloom} onChange={(v) => set({ bloom: v })} label="Bloom" />
      </Row>
      <Row label="Ambient drift" help={HELP.ambientDrift}>
        <Toggle on={prefs.ambientDrift} onChange={(v) => set({ ambientDrift: v })} label="Ambient drift" />
      </Row>
      <Row label="Reduce motion" help={HELP.reduceMotion}>
        <Toggle
          on={settings.reducedMotion}
          onChange={(v) => patch({ reducedMotion: v })}
          label="Reduce motion"
        />
      </Row>
    </>
  );
}

/* ------------------------------------------------------------------ companion */

export function CompanionSection({ settings, patch, agentName, onRenameAgent }: SectionProps) {
  const [prefs, set] = usePrefs();
  const [name, setName] = useState(agentName || prefs.companionName);
  useEffect(() => setName(agentName || prefs.companionName), [agentName, prefs.companionName]);

  return (
    <>
      <Head title="Companion" blurb="Who is standing in this world, and how she talks." />
      <div className="companion-head">
        <label className="hue-swatch" style={{ background: settings.accent }} title="Companion colour">
          <input
            type="color"
            value={settings.accent}
            aria-label="Companion colour"
            onChange={(e) => patch({ accent: e.target.value })}
          />
        </label>
        <div className="companion-head-main">
          <Field label="Display name" hint={HELP.companionName}>
            <TextInput
              value={name}
              onChange={setName}
              onEnter={() => onRenameAgent(name.trim() || "Companion")}
              ariaLabel="Display name"
            />
          </Field>
          <button className="btn sm" onClick={() => onRenameAgent(name.trim() || "Companion")}>
            Rename
          </button>
        </div>
        <Field label="Voice" hint={HELP.voice}>
          <Select
            value={prefs.voice}
            onChange={(v) => set({ voice: v })}
            ariaLabel="Voice"
            options={[
              { value: "default", label: "Default" },
              { value: "warm", label: "Warm", disabled: true },
              { value: "crisp", label: "Crisp", disabled: true },
              { value: "deep", label: "Deep", disabled: true },
            ]}
          />
        </Field>
      </div>

      <SectionLabel>Personality</SectionLabel>
      <RadioCards
        value={prefs.personality}
        onChange={(v) => set({ personality: v })}
        options={[
          { value: "quiet", label: "Quiet", blurb: "One line when she's done." },
          { value: "balanced", label: "Balanced", blurb: "The outcome, and what needs you." },
          { value: "narrated", label: "Narrated", blurb: "She talks you through the work." },
        ]}
      />

      <SectionLabel>Tone</SectionLabel>
      <RadioCards
        value={prefs.tone}
        onChange={(v) => set({ tone: v })}
        options={[
          { value: "casual", label: "Casual", blurb: "Relaxed, first names, no ceremony." },
          { value: "warm", label: "Warm", blurb: "Warm and to the point." },
          { value: "formal", label: "Formal", blurb: "Measured, precise, no slang." },
        ]}
      />

      <SectionLabel>Proactivity</SectionLabel>
      <RadioCards
        value={prefs.proactivity}
        onChange={(v) => set({ proactivity: v })}
        options={[
          { value: "asked", label: "When asked", blurb: "She waits for you to bring things up." },
          { value: "often", label: "Often", blurb: "She raises what matters, not everything." },
        ]}
      />

      <SectionLabel>Interview</SectionLabel>
      <Field label="Your goal right now" hint={HELP.goal}>
        <TextArea
          value={prefs.goal}
          onChange={(v) => set({ goal: v })}
          rows={2}
          placeholder="Ship the parity build by Friday."
        />
      </Field>
      <div className="readout">
        <span className="readout-label">How you came across</span>
        <p>{prefs.interview || HELP.interview}</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ mind */

const MODELS: Record<string, string[]> = {
  mock: ["vivarium-mock-1"],
  openai: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
  ollama: ["llama3.2", "qwen2.5-coder", "mistral"],
  opencode: ["opencode"],
  codebuddy: ["hy3", "default"],
  claude: ["sonnet", "opus"],
  codex: ["gpt-5-codex"],
  gemini: ["gemini-2.5-pro"],
  "custom-cli": [],
};

export function MindSection({ settings, patch, onRefresh }: SectionProps) {
  const [prefs, set] = usePrefs();
  const [keyDraft, setKeyDraft] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const provider = window.viv.providers.find((p) => p.id === settings.provider);
  const models = MODELS[settings.provider] ?? [];

  const saveKey = async () => {
    try {
      await window.viv.settings.setKey(keyDraft);
      setKeyDraft("");
      setKeyOpen(false);
      setStatus({ tone: "ok", text: "Key stored in the OS keychain." });
      onRefresh();
    } catch (err) {
      setStatus({ tone: "bad", text: (err as Error).message });
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      if (provider?.kind === "mock") {
        setStatus({ tone: "ok", text: "Mock provider answers locally. Nothing to reach." });
      } else if (provider?.kind === "cli") {
        setStatus({
          tone: "warn",
          text: settings.cliCommand
            ? "The command is called on the first run, not here."
            : "No command set — the provider's own binary is used.",
        });
      } else {
        const base = settings.baseUrl || (settings.provider === "ollama" ? "http://127.0.0.1:11434" : "");
        if (!base) {
          setStatus({ tone: "bad", text: "No base URL yet." });
        } else {
          const ctrl = new AbortController();
          const timer = window.setTimeout(() => ctrl.abort(), 2500);
          const res = await fetch(`${base.replace(/\/$/, "")}/models`, { signal: ctrl.signal }).catch(
            () => null,
          );
          window.clearTimeout(timer);
          if (res?.ok) setStatus({ tone: "ok", text: `Reached ${base}.` });
          else if (res) setStatus({ tone: "bad", text: `${base} answered ${res.status}.` });
          else setStatus({ tone: "bad", text: `Couldn't reach ${base}.` });
        }
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Head title="Mind" blurb="Where the thinking happens. Nothing is proxied through us — there is no us." />
      <SectionLabel>Provider</SectionLabel>
      <Row label="Provider" help={provider?.hint ?? HELP.provider}>
        <Select
          value={settings.provider}
          ariaLabel="Provider"
          onChange={(id) => {
            const next = window.viv.providers.find((p) => p.id === id);
            patch({
              provider: id as Settings["provider"],
              model: next?.defaultModel ?? settings.model,
              baseUrl:
                id === "ollama"
                  ? "http://127.0.0.1:11434"
                  : id === "openai"
                    ? "https://api.openai.com/v1"
                    : settings.baseUrl,
            });
          }}
          options={window.viv.providers.map((p) => ({ value: p.id, label: p.label }))}
        />
      </Row>

      {provider?.kind !== "cli" && (
        <Row label="Model" help={HELP.model}>
          <span className="inline-control">
            <TextInput value={settings.model} onChange={(v) => patch({ model: v })} mono />
            <span className="menu-anchor">
              <button className="btn sm" onClick={() => setModelOpen((v) => !v)} aria-label="Pick a model">
                <Icon name="down" size={12} />
              </button>
              {modelOpen && (
                <Menu onClose={() => setModelOpen(false)} width={200}>
                  {models.length === 0 && <div className="menu-note">Type an id; this provider publishes none.</div>}
                  {models.map((m) => (
                    <MenuRow
                      key={m}
                      active={m === settings.model}
                      onClick={() => {
                        patch({ model: m });
                        setModelOpen(false);
                      }}
                    >
                      {m}
                    </MenuRow>
                  ))}
                </Menu>
              )}
            </span>
          </span>
        </Row>
      )}

      {provider?.kind === "http" && (
        <Row label="Base URL" help={HELP.baseUrl}>
          <TextInput value={settings.baseUrl} onChange={(v) => patch({ baseUrl: v })} mono placeholder="https://api.example.com/v1" />
        </Row>
      )}

      {provider?.requiresKey && (
        <Row label="API key" help={HELP.apiKey}>
          <button className="btn sm" onClick={() => setKeyOpen(true)}>
            {settings.hasKey ? "Replace key" : "Add key"}
          </button>
        </Row>
      )}

      {provider?.kind === "cli" && (
        <Row label="Command" help={HELP.cliCommand}>
          <TextInput
            value={settings.cliCommand}
            onChange={(v) => patch({ cliCommand: v })}
            mono
            placeholder={settings.provider === "custom-cli" ? "my-agent --run {prompt}" : "leave blank for the default"}
          />
        </Row>
      )}

      <SectionLabel>Sampling</SectionLabel>
      <Row label="Temperature" help={HELP.temperature}>
        <Range
          label="Temperature"
          value={prefs.temperature}
          onChange={(v) => set({ temperature: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
        />
      </Row>
      <Row label="Max output tokens" help={HELP.maxTokens}>
        <TextInput
          type="number"
          value={String(prefs.maxTokens)}
          onChange={(v) => set({ maxTokens: Math.max(64, Math.min(32000, Number(v) || 2048)) })}
          mono
          ariaLabel="Max output tokens"
        />
      </Row>
      <Row label="Streaming" help={HELP.streaming}>
        <Toggle on={prefs.streaming} onChange={(v) => set({ streaming: v })} label="Streaming" />
      </Row>
      <Field label="System preamble" hint={HELP.preamble}>
        <TextArea value={prefs.preamble} onChange={(v) => set({ preamble: v })} rows={3} placeholder="Anything every reply should already know." />
      </Field>

      <div className="pane-actions">
        <button className="btn" onClick={() => void test()} disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        {status ? <Chip tone={status.tone === "ok" ? "live" : status.tone}>{status.text}</Chip> : <span className="pane-note">Local check, no request is logged.</span>}
      </div>

      {keyOpen && (
        <Modal
          title={settings.hasKey ? "Replace the key" : "Add a key"}
          onClose={() => setKeyOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setKeyOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void saveKey()} disabled={!keyDraft.trim()}>
                Save key
              </button>
            </>
          }
        >
          <p className="modal-lede">{HELP.apiKey} It never enters this window after saving.</p>
          <TextInput type="password" value={keyDraft} onChange={setKeyDraft} placeholder="sk-…" autoFocus />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ hands */

export function HandsSection({ settings, patch }: SectionProps) {
  const [prefs, set] = usePrefs();
  return (
    <>
      <Head title="Hands" blurb="What the agents may touch, and when they must ask." />
      <SectionLabel>Workspace roots</SectionLabel>
      <div className="list">
        {settings.roots.length === 0 && <div className="list-empty">{HELP.roots}</div>}
        {settings.roots.map((root) => (
          <div key={root} className="row-line">
            <code title={root}>{root}</code>
            <button
              className="btn sm ghost"
              onClick={() => patch({ roots: settings.roots.filter((r) => r !== root) })}
            >
              remove
            </button>
          </div>
        ))}
      </div>
      <div className="pane-actions">
        <button
          className="btn"
          onClick={async () => {
            await window.viv.settings.pickRoot();
            pushToast({ title: "Folders updated", tone: "ok" });
          }}
        >
          Add folder…
        </button>
        <span className="pane-note">{HELP.roots}</span>
      </div>

      <SectionLabel>Permissions</SectionLabel>
      <Row label="Read outside roots" help={HELP.outsideRoots}>
        <Toggle on={prefs.readOutsideRoots} onChange={(v) => set({ readOutsideRoots: v })} label="Read outside roots" />
      </Row>
      <Row label="Write files" help={HELP.allowWrite}>
        <Toggle on={prefs.allowWrite} onChange={(v) => set({ allowWrite: v })} label="Write files" />
      </Row>
      <Row label="Run shell commands" help={HELP.allowShell}>
        <Toggle on={prefs.allowShell} onChange={(v) => set({ allowShell: v })} label="Run shell commands" />
      </Row>
      <Row label="Network access" help={HELP.allowNetwork}>
        <Toggle on={prefs.allowNetwork} onChange={(v) => set({ allowNetwork: v })} label="Network access" />
      </Row>

      <SectionLabel>Approvals</SectionLabel>
      <RadioCards
        value={prefs.approvalMode}
        onChange={(v) => set({ approvalMode: v })}
        options={[
          { value: "manual", label: "Manual", blurb: "Companions ask before acting." },
          { value: "auto", label: "Auto", blurb: "Companions act on their own." },
        ]}
      />

      <SectionLabel>Always allowed</SectionLabel>
      {prefs.allowlist.length === 0 ? (
        <div className="list-empty">{HELP.allowlist}</div>
      ) : (
        <div className="chips">
          {prefs.allowlist.map((tool) => (
            <span key={tool} className="chip">
              {tool}
              <button
                className="chip-x"
                aria-label={`Remove ${tool}`}
                onClick={() => set({ allowlist: prefs.allowlist.filter((t) => t !== tool) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ world */

const ACCENT_SWATCHES = [
  { name: "spore", value: "#35E29B" },
  { name: "ember", value: "#FF6D00" },
  { name: "violet", value: "#A78BFA" },
  { name: "ice", value: "#5EEAD4" },
];

export function WorldSection({ settings, patch }: SectionProps) {
  const [prefs, set] = usePrefs();
  const reduce = settings.reducedMotion;
  return (
    <>
      <Head title="World" blurb="One accent, one page colour, one hairline." />
      <SectionLabel>Accent</SectionLabel>
      <div className="swatches">
        {ACCENT_SWATCHES.map((a) => (
          <button
            key={a.name}
            className={`swatch ${settings.accent.toLowerCase() === a.value.toLowerCase() ? "on" : ""}`}
            style={{ background: a.value }}
            title={a.name}
            aria-label={a.name}
            onClick={() => patch({ accent: a.value })}
          />
        ))}
        <input
          className="swatch-input"
          type="color"
          aria-label="Accent colour"
          value={settings.accent}
          onChange={(e) => patch({ accent: e.target.value })}
        />
      </div>
      <Row label="Accent" help={HELP.accent}>
        <TextInput value={settings.accent} onChange={(v) => patch({ accent: v })} mono />
      </Row>
      <Row label="Theme" help={HELP.seaTheme}>
        <Select
          value={prefs.seaTheme}
          onChange={(v) => set({ seaTheme: v })}
          ariaLabel="Theme"
          options={[
            { value: "ember", label: "Ember" },
            { value: "ash", label: "Ash" },
            { value: "moss", label: "Moss" },
          ]}
        />
      </Row>
      <Row label="Bloom strength" help={HELP.bloomStrength} disabled={reduce}>
        <Range
          label="Bloom strength"
          value={prefs.bloomStrength}
          onChange={(v) => set({ bloomStrength: v })}
          min={0}
          max={1}
          step={0.02}
          format={(v) => v.toFixed(2)}
          disabled={reduce}
        />
      </Row>
      <Row label="Fog density" help={HELP.fogDensity} disabled={reduce}>
        <Range
          label="Fog density"
          value={prefs.fogDensity}
          onChange={(v) => set({ fogDensity: v })}
          min={4}
          max={30}
          step={1}
          disabled={reduce}
        />
      </Row>
      <Row label="Floor grid" help={HELP.grid}>
        <Toggle on={prefs.grid} onChange={(v) => set({ grid: v })} label="Floor grid" />
      </Row>
      <Row label="Camera drift" help={HELP.cameraDrift} disabled={reduce}>
        <Range
          label="Camera drift"
          value={prefs.cameraDrift}
          onChange={(v) => set({ cameraDrift: v })}
          min={0}
          max={0.4}
          step={0.02}
          format={(v) => v.toFixed(2)}
          disabled={reduce}
        />
      </Row>
      <Row label="Reduce motion" help={HELP.reduceMotion}>
        <Toggle on={reduce} onChange={(v) => patch({ reducedMotion: v })} label="Reduce motion" />
      </Row>
    </>
  );
}

/* ------------------------------------------------------------------ documents */

export function DocumentsSection({}: SectionProps) {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [status, setStatus] = useState<{ documents: number; chunks: number; dir: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VaultHit[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgetDoc, setForgetDoc] = useState<VaultDocument | null>(null);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [attached, setAttached] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id?: string; name: string; description: string; body: string } | null>(null);

  const reload = useCallback(async () => {
    const [list, meta] = await Promise.all([
      window.viv.vault.list().catch(() => [] as VaultDocument[]),
      window.viv.vault.status().catch(() => null),
    ]);
    setDocs(list);
    setStatus(meta);
  }, []);

  const reloadPacks = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.viv.packs.list().catch(() => [] as ContextPack[]),
      window.viv.packs.attached().catch(() => null),
    ]);
    setPacks(list);
    setAttached(active);
  }, []);

  useEffect(() => {
    void reload();
    void reloadPacks();
  }, [reload, reloadPacks]);

  const ingest = async (folder: boolean) => {
    setBusy(true);
    try {
      const result = folder ? await window.viv.vault.importFolder() : await window.viv.vault.import();
      await reload();
      const added = result.documents.length;
      if (added === 0 && result.skipped.length === 0) return;
      pushToast({
        title: added ? `Added ${added} document${added === 1 ? "" : "s"}` : "Nothing new was added",
        body: result.skipped.length
          ? `${result.skipped.slice(0, 4).join(", ")}${result.skipped.length > 4 ? ` and ${result.skipped.length - 4} more` : ""} had no readable text.`
          : "Every file was indexed into citable passages.",
        tone: added ? "ok" : "info",
      });
    } catch (err) {
      pushToast({ title: "Import failed", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const found = await window.viv.vault.search(q).catch(() => [] as VaultHit[]);
    setHits(found);
  };

  const addNote = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await window.viv.vault.add({ title: title.trim() || undefined, body });
      setTitle("");
      setBody("");
      await reload();
      pushToast({ title: "Note indexed", body: "She can search it and cite the passage.", tone: "ok" });
    } catch (err) {
      pushToast({ title: "Could not save the note", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const savePack = async () => {
    if (!draft?.name.trim()) return;
    try {
      await window.viv.packs.save(draft);
      setDraft(null);
      await reloadPacks();
      pushToast({ title: "Pack saved", body: "It rides along whenever it is attached.", tone: "ok" });
    } catch (err) {
      pushToast({ title: "Could not save the pack", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    }
  };

  return (
    <>
      <Head title="Documents" blurb="What she can look up, cite and carry into a conversation." />
      <SectionLabel>Recall vault</SectionLabel>
      <div className="readout">
        <span className="readout-label">Index</span>
        <code title={status?.dir}>{status ? `${status.documents} documents · ${status.chunks} passages` : "reading…"}</code>
        <p>
          Files and notes stay on this machine. Search is local BM25, and every answer she gives from the vault names
          the document and passage it came from.
        </p>
      </div>
      <div className="pane-actions">
        <button className="btn" onClick={() => void ingest(false)} disabled={busy}>
          Add files…
        </button>
        <button className="btn" onClick={() => void ingest(true)} disabled={busy}>
          Add a folder…
        </button>
        <span className="pane-note">Text, Markdown, PDF, DOCX, CSV, HTML, JSON and code.</span>
      </div>
      <Field label="Search the vault" help="Matches the words you use; shows the passage, not just the file.">
        <div className="vault-search">
          <TextInput value={query} onChange={setQuery} placeholder="Search documents and notes…" onEnter={() => void search()} />
          <button className="btn sm" onClick={() => void search()}>
            Find
          </button>
        </div>
      </Field>
      {hits && (
        <div className="list">
          {hits.length === 0 ? (
            <div className="list-empty">Nothing in the vault matches that.</div>
          ) : (
            hits.map((hit, i) => (
              <div key={`${hit.documentId}-${hit.chunk}-${i}`} className="row-line">
                <div>
                  <div>
                    <strong>{hit.title}</strong> <Chip tone="idle">passage {hit.chunk}</Chip>{" "}
                    <small>score {hit.score}</small>
                  </div>
                  <small>{hit.text}</small>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      <Field label="Add a note" help="For anything you would otherwise paste into the chat each time.">
        <TextInput value={title} onChange={setTitle} placeholder="Title (optional)" />
        <TextArea value={body} onChange={setBody} rows={4} placeholder="Paste the note, brief or reference…" />
        <div className="pane-actions">
          <button className="btn" onClick={() => void addNote()} disabled={busy || !body.trim()}>
            Index note
          </button>
          <span className="pane-note">Short facts belong in Memory, not here.</span>
        </div>
      </Field>

      <SectionLabel>Documents ({docs.length})</SectionLabel>
      {docs.length === 0 ? (
        <div className="list-empty">Empty. Add a file or a note and she can cite it.</div>
      ) : (
        <div className="list">
          {docs.slice(0, 60).map((doc) => (
            <div key={doc.id} className="row-line">
              <div>
                <div>
                  <strong>{doc.title}</strong>{" "}
                  <Chip tone={doc.kind === "file" ? "cool" : "idle"}>{doc.kind}</Chip>
                </div>
                <small title={doc.source}>
                  {doc.chunks} passage{doc.chunks === 1 ? "" : "s"} · {doc.chars.toLocaleString()} chars ·{" "}
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </small>
              </div>
              <button className="btn sm ghost" onClick={() => setForgetDoc(doc)}>
                forget
              </button>
            </div>
          ))}
        </div>
      )}

      <SectionLabel>Context packs</SectionLabel>
      <p className="pane-note">
        A pack is a bundle of notes, guardrails and reference. Only the attached one rides along with every turn —
        the rest wait until she reads them or you attach them.
      </p>
      {packs.length === 0 ? (
        <div className="list-empty">No packs yet. A pack is useful for a client, a course or a long-running project.</div>
      ) : (
        <div className="list">
          {packs.map((pack) => (
            <div key={pack.id} className="row-line">
              <div>
                <div>
                  <strong>{pack.name}</strong>{" "}
                  {attached === pack.id ? <Chip tone="live" dot>attached</Chip> : null}
                </div>
                <small>
                  {pack.description || `${pack.body.length.toLocaleString()} chars`} · {new Date(pack.updatedAt).toLocaleDateString()}
                </small>
              </div>
              <div className="pack-actions">
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    const next = attached === pack.id ? null : pack.id;
                    setAttached(await window.viv.packs.attach(next));
                  }}
                >
                  {attached === pack.id ? "detach" : "attach"}
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => setDraft({ id: pack.id, name: pack.name, description: pack.description, body: pack.body })}
                >
                  edit
                </button>
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    await window.viv.packs.remove(pack.id).catch(() => undefined);
                    await reloadPacks();
                  }}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {draft ? (
        <div className="pack-editor">
          <Field label="Pack name">
            <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Acme onboarding" />
          </Field>
          <Field label="Description">
            <TextInput
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
              placeholder="What this pack is for, one line"
            />
          </Field>
          <Field label="Contents">
            <TextArea
              value={draft.body}
              onChange={(body) => setDraft({ ...draft, body })}
              rows={8}
              placeholder="Guardrails first, then reference material…"
            />
          </Field>
          <div className="pane-actions">
            <button className="btn" onClick={() => void savePack()}>
              Save pack
            </button>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="pane-actions">
          <button className="btn" onClick={() => setDraft({ name: "", description: "", body: "" })}>
            New pack
          </button>
          <span className="pane-note">Attach one pack at a time; it is included in the next turn.</span>
        </div>
      )}

      {forgetDoc && (
        <Confirm
          title={`Forget “${forgetDoc.title}”?`}
          body={
            <>
              <p>Her copy of this document and its passages are deleted from the vault. The original file on disk is untouched.</p>
              <p className="pane-note">You can import it again at any time.</p>
            </>
          }
          confirmLabel="Forget document"
          danger
          onClose={() => setForgetDoc(null)}
          onConfirm={() => {
            const target = forgetDoc;
            setForgetDoc(null);
            void window.viv.vault.forget(target.id).then((list) => {
              setDocs(list);
              void reload();
            });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ files */

export function FilesSection({ settings, info, patch }: SectionProps) {
  const [remove, setRemove] = useState<string | null>(null);

  return (
    <>
      <Head title="Files & Access" blurb="The root working directory, plus anything you grant." />
      <SectionLabel>Workspace</SectionLabel>
      <div className="readout">
        <span className="readout-label">Workspace</span>
        <code title={info?.dataDir}>{info?.dataDir ?? "…"}</code>
        <p>{HELP.workspace}</p>
      </div>
      <SectionLabel>Additional Access</SectionLabel>
      {settings.roots.length === 0 ? (
        <div className="list-empty">{HELP.extraFolders}</div>
      ) : (
        <div className="list">
          {settings.roots.map((root) => (
            <div key={root} className="folder-row">
              <Icon name="folder" size={14} />
              <code title={root}>{root}</code>
              <Chip tone="idle">granted</Chip>
              <button
                className="icon-btn sm"
                title="Remove folder"
                aria-label="Remove folder"
                onClick={() => setRemove(root)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="pane-actions">
        <button
          className="btn"
          onClick={async () => {
            await window.viv.settings.pickRoot();
            pushToast({ title: "Folder granted", tone: "ok" });
          }}
        >
          Add Folder
        </button>
        <span className="pane-note">{HELP.extraFolders}</span>
      </div>

      {remove && (
        <Confirm
          title="Remove local folder?"
          body={
            <>
              <p>
                This will remove <code>{remove}</code> from the session's access list. The folder stays
                on disk.
              </p>
            </>
          }
          confirmLabel="Remove"
          danger
          onClose={() => setRemove(null)}
          onConfirm={() => {
            patch({ roots: settings.roots.filter((r) => r !== remove) });
            pushToast({ title: "Folder removed", body: remove, tone: "info" });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ notifications */

export function NotificationsSection({ info }: SectionProps) {
  const [prefs, set] = usePrefs();
  const noTransport = !info;
  return (
    <>
      <Head title="What she tells you about" blurb="Two channels that work on this machine, and what she tells you about." />
      <Row label="In the app" help={HELP.notifInApp}>
        <Toggle on={prefs.notifInApp} onChange={(v) => set({ notifInApp: v })} label="In the app" />
      </Row>
      <Row label="On this computer" help="A native Windows notification when a reply is ready and the window is in the background.">
        <Toggle on={prefs.notifDevices} onChange={(v) => set({ notifDevices: v })} label="On this computer" />
      </Row>
      <Row label="Work finishing" help={HELP.notifFinish}>
        <Toggle on={prefs.notifFinish} onChange={(v) => set({ notifFinish: v })} label="Work finishing" />
      </Row>
      <Row label="Email summary" help={HELP.emailSummary} disabled={noTransport}>
        <Toggle on={prefs.emailSummary} onChange={() => {}} disabled label="Email summary" />
      </Row>
      <Row label="Frequency" help={HELP.emailFrequency} disabled>
        <Select
          value={prefs.emailFrequency}
          onChange={(v) => set({ emailFrequency: v })}
          disabled
          ariaLabel="Frequency"
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "never", label: "Never" },
          ]}
        />
      </Row>
      <Row label="Telegram" help={HELP.telegram}>
        <span className="inline-control">
          <Chip tone="idle">Not connected</Chip>
          <button
            className="btn sm"
            onClick={() =>
              pushToast({
                title: "Not connected in this build",
                body: "Telegram needs a bot token and a relay we do not run.",
                tone: "warn",
              })
            }
          >
            Connect
          </button>
        </span>
      </Row>
      <div className="pane-note-block">
        Email digests and Telegram need a server this build does not have, so they are shown with the
        reason instead of a switch that saves nothing. In-app cards and this computer's notifications are
        the channels that work.
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ usage */

export function BillingSection({ info }: SectionProps) {
  const [prefs] = usePrefs();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([window.viv.audit.list(), window.viv.usage.get()])
      .then(([audit, report]) => {
        setRows(audit.slice(0, 24));
        setUsage(report);
        setError(null);
      })
      .catch(() => setError("Couldn't read the ledger."));
  }, []);

  return (
    <>
      <Head title="Usage & ledger" blurb="Real counters and every action, kept on this machine. No billing exists in this build." />
      <div className="tier-row">
        <div>
          <span className="readout-label">Runs</span>
          <p className="tier-name">{usage?.usage.runs ?? 0}</p>
          <span className="pane-note">
            {usage?.usage.estTokens ?? 0} estimated tokens · {usage?.memories ?? 0} memories · {usage?.skills ?? 0} skills
          </span>
        </div>
        <div className="tier-amount">
          <b>{usage?.usage.toolCalls ?? 0}</b>
          <span>tool calls</span>
        </div>
      </div>

      <SectionLabel right={<span className="pane-note">{info ? `v${info.version}` : "local"}</span>}>Recent entries</SectionLabel>
      {error ? (
        <ErrorBlock message={error} onRetry={() => setError(null)} />
      ) : rows === null ? (
        <LoadingRows n={3} label="Reading the ledger" />
      ) : rows.length === 0 ? (
        <div className="list-empty">Nothing has run yet. Send one message; the first row appears immediately.</div>
      ) : (
        <div className="ledger">
          {rows.map((r, i) => (
            <div key={`${r.at}-${i}`} className="ledger-row">
              <Icon name={r.kind === "run" ? "spark" : "bolt"} size={13} />
              <div className="ledger-main">
                <span>{r.summary || r.tool}</span>
                <em>
                  {new Date(r.at).toLocaleString(prefs.locale)}
                  {r.agentName ? ` · ${r.agentName}` : ""}
                </em>
              </div>
              <Chip tone={r.ok ? "idle" : "bad"}>{r.ok ? r.decision : "failed"}</Chip>
            </div>
          ))}
        </div>
      )}

      <div className="pane-note-block">
        There is no tier, pack or card here. A hosted model bills you under your own key at the provider;
        this app only records what ran and what it touched.
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ machine */

export function MachineSection({ settings, patch, onRefresh, onOpen }: SectionProps) {
  const [prefs, set] = usePrefs();
  const [shot, setShot] = useState<ScreenPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setShot(await window.viv.screen.preview());
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head title="Machine access" blurb="Screen, folders and the log — what she can actually reach." />
      <div className="card">
        <div className="perm-row">
          <Icon name="screen" size={15} />
          <div className="perm-main">
            <span>See the screen</span>
            <em>One still of the primary display, only when a task refers to what is on it. Nothing clicks or types for her.</em>
          </div>
          <Chip tone={prefs.screenAccess ? "live" : "idle"}>{prefs.screenAccess ? "allowed" : "off"}</Chip>
          <Toggle on={prefs.screenAccess} onChange={(v) => set({ screenAccess: v })} label="Screen access" />
        </div>
        <div className="perm-row">
          <Icon name="eye" size={15} />
          <div className="perm-main">
            <span>What she would see</span>
            <em>{shot ? `${shot.width}×${shot.height} · captured ${new Date(shot.at).toLocaleTimeString()}` : "Take a still now; it stays in the data folder."}</em>
          </div>
          <button className="btn sm" onClick={() => void look()} disabled={busy}>
            {busy ? "Capturing…" : "Take a still"}
          </button>
        </div>
        {error && <p className="row-reason">{error}</p>}
        {shot && <img className="st-screen-preview" src={shot.dataUrl} alt="A still of this screen" />}
      </div>

      <SectionLabel
        right={
          <button
            className="btn sm"
            onClick={async () => {
              await window.viv.settings.pickRoot();
              onRefresh();
            }}
          >
            Add folder
          </button>
        }
      >
        Folders she may reach
      </SectionLabel>
      <div className="list">
        {settings.roots.length === 0 ? (
          <div className="list-empty">No folders granted. She can only read what you paste to her.</div>
        ) : (
          settings.roots.map((root) => (
            <div key={root} className="row-line">
              <Icon name="folder" size={13} />
              <code title={root}>{root}</code>
              <button
                className="btn sm ghost"
                onClick={() => {
                  patch({ roots: settings.roots.filter((r) => r !== root) });
                  pushToast({ title: "Folder removed", body: root, tone: "info" });
                }}
              >
                remove
              </button>
            </div>
          ))
        )}
      </div>

      <div className="pane-actions">
        <button className="btn" onClick={() => void window.viv.data.openDataDir()}>
          Open data folder
        </button>
        <button className="btn" onClick={() => onOpen("integrations")}>
          Connections
        </button>
      </div>
      <div className="pane-note-block">
        Captures are JPEGs in screenshots/ inside the data folder, twenty at most. The see_screen tool
        refuses outright when the switch above is off; the settings mirror decides that, not the prompt.
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ account */

export function AccountSection({ info, onOpen }: SectionProps) {
  const [prefs, set] = usePrefs();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);

  useEffect(() => {
    void Promise.all([window.viv.audit.list(), window.viv.usage.get()])
      .then(([rows, report]) => {
        setAudit(rows);
        setUsage(report);
      })
      .catch(() => undefined);
  }, []);

  const storage = Math.min(1, audit.length / 500);

  return (
    <>
      <Head title="Account" blurb="A local profile. No auth service, no plan, no invite link." />
      <div className="account-head">
        <span className="avatar lg">{(prefs.accountName || "Y").slice(0, 1).toUpperCase()}</span>
        <div className="account-head-main">
          <p className="account-name">{prefs.accountName || "You"}</p>
          <span>{prefs.accountEmail || "no email set"}</span>
        </div>
      </div>

      <SectionLabel>Profile</SectionLabel>
      <Row label="Display name" help="So she knows who she is talking to. It stays on this machine.">
        <TextInput value={prefs.accountName} onChange={(v) => set({ accountName: v })} />
      </Row>
      <Row label="Email" help={HELP.accountEmail}>
        <TextInput value={prefs.accountEmail} onChange={(v) => set({ accountEmail: v })} type="email" />
      </Row>
      <Row label="Organization" help="Only used in an export. Nothing is shared.">
        <TextInput value={prefs.organization} onChange={(v) => set({ organization: v })} />
      </Row>

      <SectionLabel>Usage</SectionLabel>
      <div className="usage-grid">
        <div>
          <span>{usage?.usage.runs ?? 0}</span>
          <em>runs</em>
        </div>
        <div>
          <span>{usage?.usage.toolCalls ?? 0}</span>
          <em>tool calls</em>
        </div>
        <div>
          <span>{usage?.memories ?? 0}</span>
          <em>memories</em>
        </div>
        <div>
          <span>{usage?.skills ?? 0}</span>
          <em>skills</em>
        </div>
      </div>
      {audit.length === 0 && <p className="pane-note">No usage yet.</p>}

      <Row label="Ledger size" help={`${audit.length} entries in audit.jsonl. Export it any time; nothing is deleted behind your back.`}>
        <ProgressRule value={storage} tone={storage > 0.85 ? "bad" : "warm"} />
      </Row>

      <SectionLabel>This device</SectionLabel>
      <div className="readout">
        <span className="readout-label">Local build</span>
        <p>{info ? `v${info.version} · ${info.platform}` : "…"} · nothing signed in, nothing to sign out of</p>
      </div>
      <div className="pane-actions">
        <button className="btn" onClick={() => onOpen("advanced")}>
          Data & retention
        </button>
        <button
          className="btn"
          onClick={async () => {
            const path = await window.viv.data.exportAll();
            pushToast({ title: path ? "Exported" : "Export failed", body: path ?? undefined, tone: path ? "ok" : "bad" });
          }}
        >
          Export everything
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ advanced */

export function AdvancedSection({ info, settings, onRefresh }: SectionProps) {
  const [prefs, set] = usePrefs();
  const [resetOpen, setResetOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const diag = useMemo(() => {
    const lines = [
      `vivarium ${info?.version ?? "?"}`,
      `platform ${info?.platform ?? "?"}`,
      `data ${info?.dataDir ?? "?"}`,
      `provider ${settings.provider} · ${settings.model || "no model"}`,
      `roots ${settings.roots.length}`,
      `retention full (append-only)`,
      `locale ${prefs.locale} · timezone ${prefs.timezone}`,
    ];
    return lines.join("\n");
  }, [info, settings.provider, settings.model, settings.roots.length, prefs.locale, prefs.timezone]);

  return (
    <>
      <Head title="Advanced" blurb="The files, the retention window, and the way out." />
      <SectionLabel>Data</SectionLabel>
      <div className="readout">
        <span className="readout-label">Data directory</span>
        <code title={info?.dataDir}>{info?.dataDir ?? "…"}</code>
        <p>{HELP.dataDir}</p>
      </div>
      <div className="pane-actions">
        <button className="btn" onClick={() => void window.viv.data.openDataDir()}>
          Reveal folder
        </button>
        <button
          className="btn"
          onClick={async () => {
            const path = await window.viv.data.exportAll();
            pushToast({
              title: path ? "Exported" : "Export failed",
              body: path ?? undefined,
              tone: path ? "ok" : "bad",
            });
          }}
        >
          Export everything
        </button>
      </div>

      <SectionLabel>Retention</SectionLabel>
      <p className="pane-note">
        The ledger is append-only and kept in full. There is no automatic deletion in this build:
        Export writes a copy, and Reset is the only thing that clears it. Memory and skills can be
        edited or deleted individually where they live.
      </p>

      <SectionLabel>Diagnostics</SectionLabel>
      <div className="diag">
        <pre>{diag}</pre>
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard?.writeText(diag).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="pane-note">{HELP.diagnostics}</p>

      <SectionLabel>Danger</SectionLabel>
      <Row label="Reset local state" help={HELP.reset}>
        <button className="btn danger" onClick={() => setResetOpen(true)}>
          Reset…
        </button>
      </Row>

      {resetOpen && (
        <Confirm
          title="Reset this world?"
          body={
            <>
              <p>
                This deletes companions, memory, the tool ledger and every local preference. Documents,
                skills and automations go back to their seeds.
              </p>
              <p className="pane-note">There is no undo and no cloud copy.</p>
            </>
          }
          confirmLabel="Reset everything"
          danger
          onClose={() => setResetOpen(false)}
          onConfirm={() => {
            void window.viv.data.reset().then(() => {
              resetPrefs();
              resetDb();
              onRefresh();
              pushToast({ title: "World reset", body: "Companions, memory, skills, ledger and preferences cleared.", tone: "info" });
            });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ real IPC lists */

export function MemoryPanel() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [draft, setDraft] = useState("");
  const reload = () => void window.viv.memory.list().then(setEntries);
  useEffect(reload, []);

  return (
    <div className="mini-panel">
      <p className="mini-panel-note">Facts the companions chose to keep. Delete one and it is gone from the next turn.</p>
      <TextInput
        value={draft}
        onChange={setDraft}
        placeholder="Add a fact by hand…"
        onEnter={() => {
          if (!draft.trim()) return;
          void window.viv.memory.add(draft).then((m) => {
            setEntries(m);
            setDraft("");
          });
        }}
      />
      {entries.length === 0 ? (
        <div className="list-empty">Nothing remembered yet.</div>
      ) : (
        entries.map((m) => (
          <div key={m.id} className="row-line">
            <div>
              <div>{m.text}</div>
              <small>
                {new Date(m.at).toLocaleString()} · {m.source}
              </small>
            </div>
            <button className="btn sm ghost" onClick={() => void window.viv.memory.forget(m.id).then(setEntries)}>
              forget
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => {
    void window.viv.audit.list().then((rows) => setEntries(rows.slice().reverse()));
  }, []);

  return (
    <div className="mini-panel">
      <p className="mini-panel-note">Every action a companion took on this machine, in order. Append-only.</p>
      {entries.length === 0 ? (
        <div className="list-empty">No actions yet.</div>
      ) : (
        entries.slice(0, 40).map((e, i) => (
          <div key={`${e.at}-${i}`} className="row-line">
            <div>
              <div className="audit-title">
                <Chip tone={e.danger === "exec" ? "bad" : e.danger === "write" ? "warn" : "idle"}>{e.danger}</Chip>
                <strong>{e.tool}</strong>
                <span className={e.ok ? "ok" : "no"}>{e.ok ? "ok" : "failed"}</span>
              </div>
              <code>{e.summary}</code>
              <small>
                {new Date(e.at).toLocaleTimeString()} · {e.decision}
              </small>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function SectionBody({
  id,
  props,
}: {
  id: string;
  props: SectionProps;
}) {
  switch (id) {
    case "prefs":
      return <PreferencesSection {...props} />;
    case "companion":
      return <CompanionSection {...props} />;
    case "mind":
      return <MindSection {...props} />;
    case "hands":
      return <HandsSection {...props} />;
    case "world":
      return <WorldSection {...props} />;
    case "documents":
      return <DocumentsSection {...props} />;
    case "files":
      return <FilesSection {...props} />;
    case "notif":
      return <NotificationsSection {...props} />;
    case "billing":
      return <BillingSection {...props} />;
    case "machine":
      return <MachineSection {...props} />;
    case "account":
      return <AccountSection {...props} />;
    case "advanced":
      return <AdvancedSection {...props} />;
    default:
      return <PreferencesSection {...props} />;
  }
}

export type { Prefs, AgentRecord };
