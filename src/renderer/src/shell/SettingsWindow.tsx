import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IntegrationStatus,
  MemoryEntry,
  ScreenPreview,
  Settings,
  SkillRecord,
  UsageReport,
  VoiceOption,
  VoiceStatus,
} from "../../../shared/types";
import type { Prefs } from "./prefs";
import { formatNumber, usePrefs } from "./prefs";
import { Icon, type IconName } from "./icons";
import { resetVoiceEngine, speakText, speakWithNeural, speakWithSystem, systemVoiceName } from "./speech";

/**
 * SETTINGS — her window, not a page.
 *
 * One geometry for the whole app: 1040×900 caps, a 48 px header and a 236 px
 * dock reserve; the window is draggable inside a clamp, remembers its position
 * for the session, swaps panes in 120 ms with an 8 px slide, and ignores Escape
 * while a field has focus. The rail is 214 px with a 2 px accent bar. Controls
 * follow one kit: an on/off toggle, mono buttons, a segmented rail, a chevron
 * select, and a dashed 18 px section label.
 *
 * Every section, description and control here is part of this app's own design
 * system (see `docs/BRAND.md`).
 */

const SECTIONS: { id: string; label: string; icon: IconName; line: string }[] = [
  { id: "account", label: "Account", icon: "user", line: "Who you are here, your devices, your privacy, your data." },
  { id: "companion", label: "Companion", icon: "spark", line: "How she looks, what she knows, and how she sounds." },
  {
    id: "preferences",
    label: "Preferences",
    icon: "sliders",
    line: "How she talks to you, what she may do alone, and how the world renders.",
  },
  { id: "machine", label: "Machine access", icon: "screen", line: "What she may reach on this computer." },
  { id: "channels", label: "Channels", icon: "send", line: "What she tells you about, and where she can act." },
  { id: "plans", label: "This build", icon: "shield", line: "Where it runs, what it costs, and what it never sends." },
  { id: "usage", label: "Usage", icon: "trend", line: "Real counters from this machine: runs, tools and what she learned." },
];

const POS_KEY = "viv.settings.pos";
const HEADER = 48;
const DOCK_RESERVE = 236;
const MAX_W = 1040;
const MAX_H = 900;
const RAIL = 214;

/** Their colour control is a full-spectrum hue rail; the accent stays a hex. */
function hexToHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 32;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 32;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueHex(hue: number): string {
  const s = 0.78;
  const l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function geometry(w: number, h: number) {
  const width = Math.min(MAX_W, Math.max(320, w - 48));
  const height = Math.min(MAX_H, Math.max(360, h - HEADER - DOCK_RESERVE - 16));
  const x = Math.round((w - width) / 2);
  const y = Math.round(HEADER + Math.max(8, (h - HEADER - DOCK_RESERVE - height) / 2));
  return { width, height, x, y };
}

/* ---- their chrome ------------------------------------------------------- */

function SectionLabel({ icon, children }: { icon?: IconName; children: React.ReactNode }) {
  return (
    <span className="st-h">
      <i className="st-h-dash" />
      {icon && <Icon name={icon} size={12} />}
      <span>{children}</span>
    </span>
  );
}

function Frame({
  label,
  icon,
  right,
  children,
}: {
  label?: string;
  icon?: IconName;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="st-frame">
      {(label || right) && (
        <header className="st-frame-head">
          {label && <SectionLabel icon={icon}>{label}</SectionLabel>}
          {right && <div className="st-frame-right">{right}</div>}
        </header>
      )}
      <div className="st-frame-body">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  value,
  mono = true,
  children,
}: {
  label: string;
  hint?: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <span className="st-row-label">{label}</span>
        {hint && <span className="st-row-hint">{hint}</span>}
      </div>
      <div className="st-row-right">
        {value !== undefined && <span className={`st-row-value ${mono ? "mono" : ""}`}>{value}</span>}
        {children}
      </div>
    </div>
  );
}

const Divider = () => <div className="st-div" role="presentation" />;

function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className="st-toggle"
      onClick={() => onChange(!on)}
    >
      <span className="st-toggle-word">{on ? "ON" : "OFF"}</span>
      <i className="st-toggle-track">
        <i className="st-toggle-knob" />
      </i>
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="st-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select className="st-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

function TextLine({
  value,
  onChange,
  placeholder,
  label,
  mono,
  type = "text",
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  mono?: boolean;
  type?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      className={`st-input ${mono ? "mono" : ""}`}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      style={style}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Button({
  children,
  onClick,
  tone = "ghost",
  disabled,
  small,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "ghost" | "primary" | "danger";
  disabled?: boolean;
  small?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`st-btn ${tone} ${small ? "sm" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Collapse({
  title,
  icon,
  summary,
  defaultOpen = false,
  tone = "normal",
  children,
}: {
  title: string;
  icon?: IconName;
  summary?: string;
  defaultOpen?: boolean;
  tone?: "normal" | "danger";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`st-collapse ${open ? "open" : ""}`}>
      <button
        type="button"
        className="st-collapse-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`st-chev ${tone === "danger" ? "danger" : ""}`}>
          <Icon name="right" size={13} />
        </i>
        <SectionLabel icon={icon}>{title}</SectionLabel>
        {summary !== undefined && <span className="st-collapse-sum">{summary}</span>}
      </button>
      {open && <div className="st-collapse-body">{children}</div>}
    </section>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="st-note">{children}</p>;

/* ---- panes -------------------------------------------------------------- */

type PaneProps = {
  settings: Settings;
  patch: (next: Partial<Settings>) => void;
  prefs: Prefs;
  setPrefs: (next: Partial<Prefs>) => void;
  info: { version: string; platform: string; dataDir: string } | null;
  agentName: string;
  onRenameAgent: (name: string) => void;
  onOpen: (id: string) => void;
  /** Re-read settings, agents and the audit log from the main process. */
  onRefresh: () => void;
};

function AccountPane({ prefs, setPrefs, info }: PaneProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const display = prefs.accountName.trim() || "You";
  const initials = display
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const since = new Date(prefs.memberSince || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <>
      {/* Their Account opens on a profile card, not a form. */}
      <div className="st-profile">
        <span className="st-avatar">{initials}</span>
        <div className="st-profile-who">
          <input
            className="st-profile-name"
            value={prefs.accountName}
            aria-label="Your name"
            placeholder="Your name"
            onChange={(e) => setPrefs({ accountName: e.target.value })}
          />
          <input
            className="st-profile-mail"
            type="email"
            value={prefs.accountEmail}
            aria-label="Your email"
            placeholder="you@example.com"
            onChange={(e) => setPrefs({ accountEmail: e.target.value })}
          />
        </div>
        <div className="st-profile-meta">
          <span className="st-meta-k">Where this runs</span>
          <span className="st-meta-plan">
            <i />
            On this machine
          </span>
          <span className="st-meta-k">Member since</span>
          <span className="st-meta-v">{since}</span>
        </div>
      </div>

      <p className="st-note">
        There is no account server behind this window. Your name and email stay in this app's data folder and are used
        only so she knows who she is talking to.
      </p>

      <Divider />

      <Frame label="This machine" icon="cpu">
        <Row label="Version" value={info ? info.version : "—"} />
        <Row label="Platform" value={info ? info.platform : "—"} />
        <Row label="Data folder" hint={info?.dataDir ?? "Kept on this machine only."}>
          <Button small onClick={() => void window.viv.data.openDataDir()}>
            Open
          </Button>
        </Row>
      </Frame>

      <Divider />

      <Frame label="Privacy" icon="shield">
        <Row
          label="Screen access"
          hint="Let her take a still of your screen when a task refers to what is on it."
          value={prefs.screenAccess ? "allowed" : "off"}
        >
          <Toggle
            label="Screen access"
            on={prefs.screenAccess}
            onChange={(screenAccess) => setPrefs({ screenAccess })}
          />
        </Row>
        <Note>
          Nothing leaves this machine except a turn you send to a provider you configured. What she learns is kept in the
          Brain, on disk, and you can edit it there.
        </Note>
      </Frame>

      <Divider />

      <Frame label="About your data" icon="folder">
        <div className="st-keeps">
          {[
            ["Conversation history", "Every message, across the app and voice."],
            ["Facts and preferences she has learned", "What she noticed and chose to keep. Editable in the Brain."],
            ["Documents and media you've brought in", "What she made for you."],
            ["Your settings", "This companion and her configuration."],
          ].map(([name, line]) => (
            <div key={name} className="st-keep">
              <b>{name}</b>
              <span>{line}</span>
            </div>
          ))}
        </div>
        <Note>We never train on it and never sell it.</Note>
      </Frame>

      <Divider />

      <Frame label="Your data" icon="download">
        <Row
          label="Download my data"
          hint={saved ? saved : "One JSON file with everything kept here."}
        >
          <Button
            small
            onClick={() =>
              void window.viv.data.exportAll().then((target) => setSaved(target ?? "Couldn't write the file."))
            }
          >
            Download
          </Button>
        </Row>
        <Row label="Reveal data folder" hint="Open the folder this app keeps on this machine.">
          <Button small onClick={() => void window.viv.data.openDataDir()}>
            Open
          </Button>
        </Row>
      </Frame>

    </>
  );
}

/**
 * VOICE — ElevenLabs, for real.
 *
 * The key is typed here and handed to the main process, which encrypts it with
 * the OS keychain and never returns it. Everything in this block is state that
 * came back from the API: whether a key works, which voices the account owns,
 * and a sample played through the same path a reply uses.
 */
function VoiceBlock({
  settings,
  patch,
  prefs,
  setPrefs,
}: {
  settings: Settings;
  patch: (p: Partial<Settings>) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [osVoice, setOsVoice] = useState<string | null>(null);
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [sttBusy, setSttBusy] = useState(false);

  const clean = (err: unknown) =>
    String(err instanceof Error ? err.message : err).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      "",
    );

  // The keychain can still be waking up in the first second of a launch; one
  // quiet retry keeps the picker from opening empty on a cold start.
  const loadVoices = useCallback((retry = true) => {
    setLoadingVoices(true);
    const again = () => {
      if (retry) window.setTimeout(() => loadVoices(false), 900);
    };
    void window.viv.voice
      .list()
      .then((rows) => {
        setVoices(rows);
        if (rows.length === 0) again();
      })
      .catch((err: unknown) => {
        setNote(clean(err));
        again();
      })
      .finally(() => setLoadingVoices(false));
  }, []);

  useEffect(() => {
    void window.viv.voice.status().then((s) => {
      setStatus(s);
      if (s.hasKey) loadVoices();
    });
    void systemVoiceName().then(setOsVoice);
  }, [loadVoices]);

  // Microphone picker: real devices, and a fresh list whenever one is plugged in.
  useEffect(() => {
    let alive = true;
    const load = () => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          if (!alive) return;
          const rows = list
            .filter((d) => d.kind === "audioinput")
            .map((d, i) => ({ id: d.deviceId || "default", label: d.label || `Microphone ${i + 1}` }));
          setMics(rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i));
        })
        .catch(() => undefined);
    };
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, []);

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const next = await window.viv.voice.setKey(key);
      setStatus(next);
      setKey("");
      // A new key deserves a fresh try before the free voice is used again.
      resetVoiceEngine();
      loadVoices();
    } catch (err) {
      setNote(clean(err));
    } finally {
      setBusy(false);
    }
  };

  const play = async (text: string) => {
    setBusy(true);
    setNote(null);
    setPlaying(true);
    try {
      const engine = await speakText(text);
      setNote(
        engine === "system"
          ? "Spoken with the free Windows voice — the neural voice could not be reached."
          : engine === "neural"
            ? "Spoken with the free Microsoft neural voice."
            : "Spoken with ElevenLabs.",
      );
    } catch (err) {
      setNote(clean(err));
    } finally {
      setPlaying(false);
      setBusy(false);
    }
  };

  const playFree = async () => {
    setNote(null);
    try {
      await speakWithSystem("Hello. This voice is free and lives on this computer.");
      setNote("Spoken offline with the free Windows voice.");
    } catch (err) {
      setNote(clean(err));
    }
  };

  const playNatural = async () => {
    setNote(null);
    setBusy(true);
    try {
      const ok = await speakWithNeural(
        "Hey. So this is the free voice that sounds like a person, not a machine. What do you think?",
      );
      setNote(ok ? "Spoken with the free Microsoft neural voice." : "The neural voice could not be reached just now.");
    } catch (err) {
      setNote(clean(err));
    } finally {
      setBusy(false);
    }
  };

  const installHearing = async () => {
    setSttBusy(true);
    setNote(null);
    try {
      const next = await window.viv.voice.installStt();
      setStatus(next);
      setNote(next.stt?.detail ?? (next.stt?.available ? `Local hearing ready — ${next.stt.backend}.` : "No local engine was found."));
    } catch (err) {
      setNote(clean(err));
    } finally {
      setSttBusy(false);
    }
  };

  const hasKey = status?.hasKey ?? settings.hasVoiceKey ?? false;

  return (
    <>
      <Frame label="Her voice · ElevenLabs" icon="wave">
        <Row
          label="API key"
          hint={
            hasKey
              ? `Saved in the ${status?.source === "environment" ? "environment" : "OS keychain"}. It is never shown again.`
              : "From elevenlabs.io → Profile → API keys."
          }
        >
          <div className="st-inline">
            <TextLine
              type="password"
              value={key}
              onChange={setKey}
              label="ElevenLabs API key"
              placeholder={hasKey ? "Replace key…" : "sk_…"}
              mono
              style={{ minWidth: 190 }}
            />
            <Button tone="primary" small onClick={() => void save()} disabled={busy || !key.trim()}>
              Save
            </Button>
          </div>
        </Row>

        <Row
          label="Voice"
          hint={
            !hasKey
              ? "Add a key to list voices."
              : loadingVoices
                ? "Loading voices…"
                : `${voices.length} voices on this account.`
          }
        >
          <Select
            label="Voice"
            value={settings.voiceId ?? ""}
            onChange={(v) => patch({ voiceId: v })}
          >
            <option value="">Account default</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.detail ? ` — ${v.detail}` : ""}
              </option>
            ))}
          </Select>
        </Row>

        <Row label="Model" hint="Multilingual v2 reads the room; scribe_v1 transcribes you.">
          <span className="st-mono-note">eleven_multilingual_v2</span>
        </Row>

        <Row label="Hear her" hint="Tries ElevenLabs; falls back to the free OS voice if credits run out.">
          <Button small onClick={() => void play("Hello. I am here, and this is how I sound.")} disabled={busy}>
            <Icon name="wave" size={12} />
            {playing ? "Speaking…" : "Play a sample"}
          </Button>
        </Row>

        <Row label="Natural voice" hint="Microsoft's neural read-aloud voice. Free, no key, sounds like a person; needs a connection.">
          <Button small onClick={() => void playNatural()} disabled={busy}>
            Play natural
          </Button>
        </Row>

        <Row
          label="Offline voice"
          hint={
            osVoice
              ? `${osVoice} — installed on this PC, no credits, works offline.`
              : "No system voice was found on this machine."
          }
        >
          <Button small onClick={() => void playFree()} disabled={!osVoice}>
            Play offline
          </Button>
        </Row>

        {note && <Note>{note}</Note>}
        {!hasKey && (
          <Note>
            Without a key she still speaks with the free Windows voice. With one, ElevenLabs is tried first and the free
            voice covers a quota error. The key stays on this machine.
          </Note>
        )}
      </Frame>
      <Divider />
      <Frame label="What she hears" icon="mic">
        <Row label="Push to talk" hint="Space anywhere in the world opens the pill; closing it transcribes what you said.">
          <span className="st-kbd">SPACE</span>
        </Row>
        <Row label="Microphone" hint="The input the voice pill records from.">
          <Select label="Microphone" value={prefs.micId} onChange={(micId) => setPrefs({ micId })}>
            <option value="default">System default</option>
            {mics
              .filter((m) => m.id !== "default")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </Select>
        </Row>
        <Row
          label="Offline hearing"
          hint={
            status?.stt?.available
              ? `${status.stt.backend} · ${status.stt.model} — runs on this PC, no key and no network.`
              : (status?.stt?.detail ?? "Checking for a local recogniser…")
          }
        >
          <div className="st-inline">
            <span className={"chip " + (status?.stt?.available ? "live" : "idle")}>
              {status?.stt?.available ? "Installed" : "System voice"}
            </span>
            {!status?.stt?.available && (
              <Button small onClick={() => void installHearing()} disabled={sttBusy}>
                {sttBusy ? "Copying…" : "Use local copy"}
              </Button>
            )}
          </div>
        </Row>
        <Note>
          Clips try the local whisper.cpp model first, then the Windows recogniser, then ElevenLabs Scribe if a key is
          present. The clip is deleted after transcription and never leaves the machine on the offline path.
        </Note>
      </Frame>
    </>
  );
}

/** Her long-term facts, editable in place. What she reads next turn is this. */
function MemoryBlock() {
  const [rows, setRows] = useState<MemoryEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => void window.viv.memory.list().then(setRows);
  useEffect(load, []);

  const commit = async (row: MemoryEntry) => {
    const next = (edits[row.id] ?? row.text).trim();
    if (!next || next === row.text) return;
    setBusy(true);
    try {
      setRows(await window.viv.memory.update(row.id, next));
      setEdits(({ [row.id]: _drop, ...rest }) => rest);
    } finally {
      setBusy(false);
    }
  };

  const forget = async (id: string) => {
    setRows(await window.viv.memory.forget(id));
  };

  const remember = async () => {
    const text = fresh.trim();
    if (!text) return;
    setBusy(true);
    try {
      setRows(await window.viv.memory.add(text));
      setFresh("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame label="What she knows about you" icon="brain" right={<span className="st-autosave">{rows.length} facts</span>}>
      <Note>
        Kept from your conversations. Edit a line and she reads the corrected version on the next turn; delete anything
        that is wrong or private. This is the whole store — memory, not a hidden profile.
      </Note>
      {rows.length === 0 ? (
        <Note>Nothing yet. Tell her a preference, or add one below.</Note>
      ) : (
        <div className="st-memory">
          {[...rows]
            .slice(-10)
            .reverse()
            .map((row) => (
              <div key={row.id} className="st-memory-row">
                <input
                  value={edits[row.id] ?? row.text}
                  aria-label="A fact she keeps"
                  onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  onBlur={() => void commit(row)}
                  disabled={busy}
                />
                <button type="button" aria-label="Forget this" onClick={() => void forget(row.id)}>
                  <Icon name="trash" size={11} />
                </button>
              </div>
            ))}
        </div>
      )}
      <div className="st-inline">
        <TextLine
          value={fresh}
          onChange={setFresh}
          label="Add a fact"
          placeholder="e.g. I prefer short answers"
        />
        <Button small onClick={() => void remember()} disabled={busy || !fresh.trim()}>
          Remember
        </Button>
      </div>
    </Frame>
  );
}

function CompanionPane({ settings, patch, prefs, setPrefs, agentName, onRenameAgent, onOpen }: PaneProps) {
  const [tab, setTab] = useState<"identity" | "skills" | "voice" | "abilities">("identity");
  const [learned, setLearned] = useState<SkillRecord[]>([]);

  useEffect(() => {
    let alive = true;
    void window.viv.skills.list().then((rows) => {
      if (alive) setLearned(rows);
    });    return () => {
      alive = false;
    };
    // Reload when the skills tab opens: a skill can be learned mid-conversation.
  }, [tab]);

  return (
    <>
      <div className="st-subtabs" role="tablist" aria-label="What to configure">
        {(["identity", "skills", "voice", "abilities"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "on" : ""}
            onClick={() => setTab(id)}
          >
            {id}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <>
          <Frame
            label="Colour"
            icon="spark"
            right={
              <div className="st-colour-right">
                <div className="st-mini-seg">
                  <Seg
                    label="Whose colour"
                    value={prefs.workerColour}
                    options={[
                      { value: "companion", label: agentName || "Hers" },
                      { value: "own", label: "Workers" },
                    ]}
                    onChange={(workerColour) => setPrefs({ workerColour })}
                  />
                </div>
                <button type="button" className="st-reset" onClick={() => patch({ accent: "#35E29B" })}>
                  Reset
                </button>
              </div>
            }
          >
            <div className="st-hue-wrap">
              <div className="st-hue">
                <span className="st-hue-mark" style={{ left: "33.3%" }} />
                <span className="st-hue-mark" style={{ left: "66.6%" }} />
                <span
                  className="st-hue-dot"
                  style={{ left: `${(hexToHue(settings.accent) / 360) * 100}%`, background: settings.accent }}
                />
              </div>
              <input
                className="st-hue-input"
                type="range"
                min={0}
                max={359}
                value={Math.round(hexToHue(settings.accent))}
                aria-label="Companion colour"
                onChange={(e) => patch({ accent: hueHex(Number(e.target.value)) })}
              />
            </div>
          </Frame>

          <Frame label="System prompt" icon="hash" right={<span className="st-autosave">Auto-saves</span>}>
            <textarea
              className="st-textarea"
              value={prefs.preamble}
              aria-label="System prompt"
              placeholder="How she should think, speak and carry herself."
              onChange={(e) => setPrefs({ preamble: e.target.value })}
            />
          </Frame>

          <Divider />

          <Frame label="Name" icon="user">
            <Row label="Called">
              <TextLine value={agentName} onChange={onRenameAgent} label="Her name" placeholder="Her name" />
            </Row>
            <Row label="How she sounds">
              <Select
                label="Personality"
                value={prefs.personality}
                onChange={(v) => setPrefs({ personality: v as Prefs["personality"] })}
              >
                <option value="quiet">Quiet</option>
                <option value="balanced">Balanced</option>
                <option value="narrated">Narrated</option>
              </Select>
            </Row>
          </Frame>
        </>
      )}

      {tab === "skills" && (
        <>
          <Frame label="What she can do without being told twice" icon="skill" right={<Button small onClick={() => onOpen("skills")}>Browse</Button>}>
            <div className="st-skills">
              {[
                { name: "Local files", line: "Reading, writing and moving what you keep in her folders.", on: true },
                { name: "Terminal", line: "Running a command she writes herself.", on: prefs.allowShell },
                { name: "Browsing", line: "Opening a page or calling a service for you.", on: prefs.allowNetwork },
                { name: "Documents", line: "Drafting, editing and saving the files you ask for.", on: true },
                {
                  name: "Remembering",
                  line: "Keeping facts and preferences about you, and correcting them when they change.",
                  on: prefs.autoMemory,
                },
                {
                  name: "Learning skills",
                  line: "Writing a procedure down after it worked, so the next one is faster.",
                  on: prefs.autoSkills,
                },
              ].map((s) => (
                <div key={s.name} className="st-skill">
                  <span className="st-skill-mark" data-on={s.on} />
                  <span className="st-skill-text">
                    <b>{s.name}</b>
                    <em>{s.line}</em>
                  </span>
                  <span className={`st-skill-state ${s.on ? "on" : ""}`}>{s.on ? "Installed" : "Off"}</span>
                </div>
              ))}
            </div>
            {learned.length > 0 && (
              <>
                <span className="section-label">Learned, by her</span>
                <div className="st-skills">
                  {learned.slice(0, 6).map((s) => (
                    <div key={s.id} className="st-skill">
                      <span className="st-skill-mark" data-on />
                      <span className="st-skill-text">
                        <b>{s.name}</b>
                        <em>{s.description || s.instructions.slice(0, 120)}</em>
                      </span>
                      <span className="st-skill-state on">
                        {s.source === "learned" ? `learned · ${s.uses} use${s.uses === 1 ? "" : "s"}` : "yours"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <Note>
              Learned skills are written by her after a job works; both lists are on the Skills screen, where you can edit
              or delete them.
            </Note>
          </Frame>
        </>
      )}

      {tab === "voice" && <VoiceBlock settings={settings} patch={patch} prefs={prefs} setPrefs={setPrefs} />}

      {tab === "abilities" && (
        <>
          <Frame label="What she may do on her own" icon="bolt">
            <Row label="Run commands" hint="Terminal work she started herself.">
              <Toggle label="Run commands" on={prefs.allowShell} onChange={(allowShell) => setPrefs({ allowShell })} />
            </Row>
            <Row label="Write files" hint="Creating and changing documents outside the data folder.">
              <Toggle label="Write files" on={prefs.allowWrite} onChange={(allowWrite) => setPrefs({ allowWrite })} />
            </Row>
            <Row label="Reach the network" hint="Fetching a page or calling a service for you.">
              <Toggle label="Reach the network" on={prefs.allowNetwork} onChange={(allowNetwork) => setPrefs({ allowNetwork })} />
            </Row>
            <Row label="Read outside her folders" hint="Opening a file you did not hand her first.">
              <Toggle
                label="Read outside her folders"
                on={prefs.readOutsideRoots}
                onChange={(readOutsideRoots) => setPrefs({ readOutsideRoots })}
              />
            </Row>
            <Row label="See the screen" hint="A still of your screen when a task refers to what is on it.">
              <Toggle
                label="See the screen"
                on={prefs.screenAccess}
                onChange={(screenAccess) => setPrefs({ screenAccess })}
              />
            </Row>
            <Row
              label="Control this computer"
              hint="Move the mouse and type in your apps. Every click and keystroke asks first, and the pointer is shown before it lands."
            >
              <Toggle
                label="Control this computer"
                on={prefs.desktopControl}
                onChange={(desktopControl) => setPrefs({ desktopControl })}
              />
            </Row>
          </Frame>
          <Divider />
          <Frame label="What she learns" icon="brain">
            <Row
              label="Remember facts"
              hint="Keeps durable facts and preferences from a finished turn, and replaces one when you correct it."
            >
              <Toggle label="Remember facts" on={prefs.autoMemory} onChange={(autoMemory) => setPrefs({ autoMemory })} />
            </Row>
            <Row
              label="Write skills"
              hint="After a multi-step job works, saves the procedure so she can follow it next time."
            >
              <Toggle label="Write skills" on={prefs.autoSkills} onChange={(autoSkills) => setPrefs({ autoSkills })} />
            </Row>
            <Row label="What she keeps" hint={`${learned.length} learned skill${learned.length === 1 ? "" : "s"}; facts are editable in the Brain.`}>
              <Button small onClick={() => onOpen("brain")}>
                Open the Brain
              </Button>
            </Row>
            <Row label="Skills" hint="Everything she has learned, with the instructions she will follow.">
              <Button small onClick={() => onOpen("skills")}>
                Open Skills
              </Button>
            </Row>
            <Row label="Conversation history" hint="Every message, so she can pick up where you left off.">
              <span className="st-mono-note">kept on this machine</span>
            </Row>
          </Frame>
          <Divider />
          <MemoryBlock />
        </>
      )}
    </>
  );
}

function PreferencesPane({ settings, patch, prefs, setPrefs }: PaneProps) {
  return (
    <>
      <Frame label="Without asking first" icon="shield">
        <div className="st-perms">
          {[
            {
              key: "autoEveryday" as const,
              icon: "check" as IconName,
              tone: "green",
              title: "Everyday work",
              line: "Search, read files, write and edit documents, hand work to workers, remember things, fetch a page.",
            },
            {
              key: "autoBuild" as const,
              icon: "file" as IconName,
              tone: "amber",
              title: "Building things",
              line: "Create skills and automations; change dashboards, canvases, widgets and collections.",
            },
            {
              key: "autoDestroy" as const,
              icon: "trash" as IconName,
              tone: "red",
              title: "Deleting and sending",
              line: "Delete documents and collections. Send email, post messages, write to connected apps.",
            },
          ].map((row) => (
            <div key={row.key} className="st-perm">
              <span className={`st-perm-icon ${row.tone}`}>
                <Icon name={row.icon} size={13} />
              </span>
              <div className="st-perm-text">
                <b>{row.title}</b>
                <span>{row.line}</span>
              </div>
              <Toggle
                label={row.title}
                on={prefs[row.key]}
                onChange={(next) => setPrefs({ [row.key]: next } as Partial<Prefs>)}
              />
            </div>
          ))}
        </div>
        <p className="st-perm-warn">
          <Icon name="warn" size={12} />
          She can delete things and send messages out of the app without asking.
        </p>
      </Frame>

      <Divider />

      <Frame label="How she works with you" icon="hash">
        <Row label="Reaching out" hint="Only when asked, or when something is worth telling you.">
          <Seg
            label="Reaching out"
            value={prefs.proactivity}
            options={[
              { value: "asked", label: "Asked" },
              { value: "often", label: "Often" },
            ]}
            onChange={(proactivity) => setPrefs({ proactivity })}
          />
        </Row>
        <Row label="Personality">
          <Select
            label="Personality"
            value={prefs.personality}
            onChange={(v) => setPrefs({ personality: v as Prefs["personality"] })}
          >
            <option value="quiet">Quiet</option>
            <option value="balanced">Balanced</option>
            <option value="narrated">Narrated</option>
          </Select>
        </Row>
      </Frame>

      <Divider />

      <Collapse title="Look" icon="screen" summary="Render quality and the bloom glow">
        <Row label="Render quality">
          <Seg
            label="Render quality"
            value={prefs.renderQuality}
            options={[
              { value: "low", label: "Low" },
              { value: "balanced", label: "Balanced" },
              { value: "high", label: "High" },
            ]}
            onChange={(renderQuality) => setPrefs({ renderQuality })}
          />
        </Row>
        <Row label="Bloom" hint="The glow around her orb and the sea crests.">
          <Toggle label="Bloom" on={prefs.bloom} onChange={(bloom) => setPrefs({ bloom })} />
        </Row>
        <Row label="Ambient drift" hint="Let the world keep moving while she is idle.">
          <Toggle label="Ambient drift" on={prefs.ambientDrift} onChange={(ambientDrift) => setPrefs({ ambientDrift })} />
        </Row>
      </Collapse>

      <Divider />

      <Collapse title="Voice" icon="mic" summary="Push to talk, microphone and speaker">
        <Row label="Speak replies" hint="One short opening while the answer is still being written, so it feels like a conversation instead of a recital. She never reads the list, the code or the whole answer back to you.">
          <Toggle label="Speak replies" on={prefs.speakReplies} onChange={(speakReplies) => setPrefs({ speakReplies })} />
        </Row>
        <Row
          label="Read full answers"
          hint="Off is the natural conversation: a sentence or two, then silence. On reads the rest once at the end, skipping anything she already said and never reading code, paths or tables."
        >
          <Toggle label="Read full answers" on={prefs.speakFull} onChange={(speakFull) => setPrefs({ speakFull })} />
        </Row>
        <Row label="Her voice">
          <Select label="Her voice" value={prefs.voice} onChange={(v) => setPrefs({ voice: v as Prefs["voice"] })}>
            <option value="default">Default</option>
            <option value="warm">Warm</option>
            <option value="crisp">Crisp</option>
            <option value="deep">Deep</option>
          </Select>
        </Row>
        <Note>Spacebar holds the microphone; releasing sends it.</Note>
      </Collapse>

      <Divider />

      <Frame label="On-screen companion" icon="dish">
        <Row
          label="Island mode"
          hint="A slim bar across the top of the screen instead of the orb. Same thread, same microphone; it stays above other windows."
          value={prefs.islandMode ? "bar" : "orb"}
        >
          <Toggle label="Island mode" on={prefs.islandMode} onChange={(islandMode) => setPrefs({ islandMode })} />
        </Row>
        <Row label="Talk key" hint="Show the companion and start listening. Press it again to stop and send.">
          <span className="st-mono">Ctrl+Shift+Space</span>
        </Row>
        <Row label="Point and ask" hint="Puts the cursor's spot in front of her and answers there, without taking the app away from you.">
          <span className="st-mono">Ctrl+Shift+T</span>
        </Row>
        <Row label="Show it now" hint="Bring the on-screen companion forward.">
          <Button
            small
            onClick={() => {
              void window.viv.overlay.show();
            }}
          >
            Show the Knot
          </Button>
        </Row>
      </Frame>
    </>
  );
}

function MachinePane({ settings, patch, prefs, setPrefs, info, onRefresh, onOpen }: PaneProps) {
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

  const addFolders = async () => {
    await window.viv.settings.pickRoot();
    onRefresh();
  };

  return (
    <>
      <Frame label="Screen access" icon="screen">
        <Row
          label="Let her see the screen"
          hint="One still of the primary display, only when a task refers to what is on it. Nothing clicks or types for her."
          value={prefs.screenAccess ? "allowed" : "off"}
        >
          <Toggle
            label="Let her see the screen"
            on={prefs.screenAccess}
            onChange={(screenAccess) => setPrefs({ screenAccess })}
          />
        </Row>
        <Row label="What she would see" hint={shot ? `Captured ${new Date(shot.at).toLocaleTimeString()} · ${shot.width}×${shot.height}` : "Take one still now. It is saved in the data folder; she sees nothing until you allow it."}>
          <Button small onClick={() => void look()} disabled={busy}>
            {busy ? "Capturing…" : "Take a still"}
          </Button>
        </Row>
        {error && <Note>{error}</Note>}
        {shot && <img className="st-screen-preview" src={shot.dataUrl} alt="A still of this screen" />}
        <Note>
          Captures stay in <span className="st-mono">screenshots/</span> inside the data folder. Vision needs a model that can
          see images; text-only models still get the saved path.
        </Note>
      </Frame>

      <Divider />

      <Frame
        label="Connections"
        icon="plug"
        right={
          <Button small onClick={() => onOpen("integrations")}>
            Open
          </Button>
        }
      >
        <Note>
          The signed-in browser, Ollama, the CLI agents and the voice key are measured on the Integrations screen — what
          answers is listed as ready, what does not is listed with the fix.
        </Note>
      </Frame>

      <Divider />

      <Frame label="Local activity log" icon="receipt">
        <Row label="What she did here" hint="Every command, file write and approval, kept in audit.jsonl on this machine.">
          <Button small onClick={() => void window.viv.data.openDataDir()}>
            Reveal log
          </Button>
        </Row>
      </Frame>

      <Divider />

      <Frame label="Folders she may reach" icon="folder" right={<Button small onClick={() => void addFolders()}>Add folder</Button>}>
        {settings.roots.length === 0 && <Note>No folders granted. She can only read what you paste to her.</Note>}
        <div className="st-list">
          {settings.roots.map((root) => (
            <div key={root} className="st-list-row">
              <Icon name="folder" size={12} />
              <span>{root}</span>
              <button
                type="button"
                className="st-list-x"
                aria-label={`Remove ${root}`}
                onClick={() => patch({ roots: settings.roots.filter((r) => r !== root) })}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
        <Note>
          Data folder: <span className="st-mono">{info?.dataDir ?? "—"}</span>
        </Note>
      </Frame>
    </>
  );
}

function ChannelsPane({ prefs, setPrefs, onOpen }: PaneProps) {
  return (
    <>
      <Frame label="What she tells you about" icon="bell">
        <Row label="In the app" hint="Toasts and the drawer's activity as work finishes.">
          <Toggle label="In the app" on={prefs.notifInApp} onChange={(notifInApp) => setPrefs({ notifInApp })} />
        </Row>
        <Row
          label="On this computer"
          hint="A native notification when an answer is ready and this window is in the background."
        >
          <Toggle
            label="On this computer"
            on={prefs.notifDevices}
            onChange={(notifDevices) => setPrefs({ notifDevices })}
          />
        </Row>
        <Row label="Work finishing" hint="A note when she finishes something you asked for.">
          <Toggle label="Work finishing" on={prefs.notifFinish} onChange={(notifFinish) => setPrefs({ notifFinish })} />
        </Row>
      </Frame>

      <Divider />

      <Frame label="Where she can act" icon="plug">
        <Row label="Connected places" hint="The signed-in browser, model, voice and folders — measured, not assumed.">
          <Button small onClick={() => onOpen("integrations")}>
            Open Integrations
          </Button>
        </Row>
        <Note>
          Email digests and Telegram need a server this build does not have, so they are not offered. What works is local:
          cards in the app and this computer's own notifications.
        </Note>
      </Frame>
    </>
  );
}

function PlansPane({ settings, info, onOpen }: PaneProps) {
  return (
    <>
      <Frame label="Local by default" icon="shield">
        <p className="st-note">
          There is no account to buy and no credits to run out of in this build. Conversations, memory, skills and the
          ledger live on this machine. A hosted model is the only thing that can cost money, and you pay that provider
          directly.
        </p>
        <Row label="Licence" value="Apache-2.0" />
        <Row label="Version" value={info?.version ?? "—"} />
        <Row label="Platform" value={info?.platform ?? "—"} />
      </Frame>

      <Divider />

      <Frame label="What is running" icon="cpu">
        <Row
          label="Mind"
          hint="Where the thinking happens: a hosted endpoint or a CLI agent installed on this machine."
          value={`${window.viv.providers.find((p) => p.id === settings.provider)?.label ?? settings.provider}${
            settings.model ? ` · ${settings.model}` : ""
          }`}
        >
          <Button small onClick={() => onOpen("configure")}>
            Configure
          </Button>
        </Row>
        <Row label="Connections" hint="Browser, Ollama, CLI agents, voice and folders — measured live.">
          <Button small onClick={() => onOpen("integrations")}>
            Open Integrations
          </Button>
        </Row>
        <Row
          label="Folders she may use"
          hint="Grant or remove them in Settings → Machine access."
          value={settings.roots.length ? `${settings.roots.length} granted` : "none"}
        />
        <Row label="Data folder" hint={info?.dataDir ?? "—"}>
          <Button small onClick={() => void window.viv.data.openDataDir()}>
            Open
          </Button>
        </Row>
      </Frame>

      <Divider />

      <Frame label="Paying for a hosted model" icon="credit">
        <Note>
          If you point the mind at OpenAI, OpenRouter, Groq or another hosted endpoint, that provider bills you under
          your own key. This app has no subscription, no invoice and no way to spend on your behalf.
        </Note>
        <Row label="Where keys live" hint="Encrypted with the OS keychain. Never shown again, never sent to this window." />
      </Frame>
    </>
  );
}

function UsagePane(_props: PaneProps) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.viv.usage
      .get()
      .then(setReport)
      .catch((err: unknown) => setError(String(err instanceof Error ? err.message : err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const usage = report?.usage;
  const runs = report?.runs ?? [];

  return (
    <>
      <div className="st-credit-card">
        <div className="st-credit-left">
          <span className="st-meta-k">Runs on this machine</span>
          <b>{formatNumber(usage?.runs ?? 0, "en-US")}</b>
          <span className="st-spent">
            {formatNumber(usage?.toolCalls ?? 0, "en-US")} tool call{(usage?.toolCalls ?? 0) === 1 ? "" : "s"} ·{" "}
            {formatNumber(usage?.estTokens ?? 0, "en-US")} estimated tokens
          </span>
          <span className="st-live">
            <i />
            Measured locally · never billed
          </span>
        </div>
        <div className="st-credit-right">
          <div className="st-credit-rows">
            <span>
              <i className="plan" />
              Memories
              <b>{formatNumber(report?.memories ?? 0, "en-US")}</b>
            </span>
            <span>
              <i className="topup" />
              Skills
              <b>{formatNumber(report?.skills ?? 0, "en-US")}</b>
            </span>
            <span>
              <i className="earned" />
              Last run
              <b>
                {runs[0]
                  ? new Date(runs[0].startedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </b>
            </span>
          </div>
        </div>
      </div>

      <div className="st-subhead">
        <span>Recent runs</span>
        <Button small onClick={load}>
          <Icon name="refresh" size={11} /> Refresh
        </Button>
      </div>

      {error && <Note>{error}</Note>}
      {runs.length === 0 ? (
        <div className="st-empty">Nothing has run yet. Send one message and the counters start here.</div>
      ) : (
        <div className="st-list">
          {runs.slice(0, 12).map((run) => {
            const seconds = run.endedAt ? Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000)) : null;
            return (
              <div key={run.id} className="st-list-row">
                <span className="st-mono">
                  {new Date(run.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>{run.agentName}</span>
                <span className="st-mono">
                  {run.hops + 1} turn{run.hops === 0 ? "" : "s"} · {run.toolCalls} tool{run.toolCalls === 1 ? "" : "s"}{" "}
                  {seconds === null ? "" : `· ${seconds}s`}
                </span>
                <span className={`st-list-tag ${run.status === "done" ? "" : "bad"}`}>{run.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {(() => {
        const votes = report?.feedback ?? [];
        const up = votes.filter((v) => v.value === "up").length;
        const down = votes.filter((v) => v.value === "down").length;
        return (
          <>
            <div className="st-subhead">
              <span>Answer feedback</span>
              <span className="st-mono-note">
                {up} good · {down} missed
              </span>
            </div>
            {votes.length === 0 ? (
              <div className="st-empty">
                Good / Missed under an answer is a real vote: it moves the approach that produced it up or down in the list
                below.
              </div>
            ) : (
              <div className="st-list">
                {votes.slice(0, 8).map((vote) => (
                  <div key={vote.runId} className="st-list-row">
                    <span className="st-mono">
                      {new Date(vote.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>{vote.value === "up" ? "Good" : "Missed"}</span>
                    <span className="st-mono">{vote.runId.slice(0, 8)}</span>
                    <span className={`st-list-tag ${vote.value === "down" ? "bad" : ""}`}>{vote.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {(report?.workflows ?? []).length > 0 && (
        <>
          <div className="st-subhead">
            <span>Approaches it mined</span>
          </div>
          <div className="st-list">
            {report!.workflows.slice(0, 8).map((workflow) => {
              const rate = Math.round((workflow.successes / Math.max(1, workflow.attempts)) * 100);
              return (
                <div key={workflow.id} className="st-list-row" title={`${workflow.task}\n${workflow.tools.join(" → ") || "no app tools"}`}>
                  <span
                    style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {workflow.task}
                  </span>
                  <span className="st-mono">{workflow.strategy}</span>
                  <span className="st-list-tag">
                    {rate}% · {workflow.attempts} run{workflow.attempts === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })}
          </div>
          <Note>
            Each finished run records the approach and its tools. Similar tasks explore the untried approaches once, then reuse the one
            with the best completion record. That is why the same request starts to take the same good path.
          </Note>
        </>
      )}

      <Divider />

      <Frame label="What these counters are" icon="receipt">
        <Note>
          Every finished run adds its turns, tool calls and characters here. Tokens are a local estimate at four
          characters per token, not a bill. The same numbers feed the Ledger in the dock.
        </Note>
      </Frame>
    </>
  );
}

function Pane({ section, ...props }: PaneProps & { section: string }) {
  switch (section) {
    case "account":
      return <AccountPane {...props} />;
    case "companion":
      return <CompanionPane {...props} />;
    case "preferences":
      return <PreferencesPane {...props} />;
    case "machine":
      return <MachinePane {...props} />;
    case "channels":
      return <ChannelsPane {...props} />;
    case "plans":
      return <PlansPane {...props} />;
    case "usage":
      return <UsagePane {...props} />;
    default:
      return null;
  }
}

/* ---- the window --------------------------------------------------------- */

export function SettingsWindow({
  settings,
  patch,
  info,
  agentName,
  onRenameAgent,
  onClose,
  onOpen,
  onRefresh,
  initial,
}: {
  settings: Settings;
  patch: (next: Partial<Settings>) => void;
  info: { version: string; platform: string; dataDir: string } | null;
  agentName: string;
  onRenameAgent: (name: string) => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  initial?: string;
}) {
  const [prefs, setPrefs] = usePrefs();
  const [active, setActive] = useState(initial ?? "account");
  const [size, setSize] = useState(() => geometry(window.innerWidth, window.innerHeight));
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const g = geometry(window.innerWidth, window.innerHeight);
    try {
      const saved = JSON.parse(sessionStorage.getItem(POS_KEY) ?? "null") as { x: number; y: number } | null;
      if (saved && typeof saved.x === "number") return saved;
    } catch {
      /* first open */
    }
    return { x: g.x, y: g.y };
  });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  useEffect(() => {
    const onResize = () => setSize(geometry(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* private mode */
    }
  }, [pos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      // Their rule: Escape inside a field is the field's, not the window's.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setPos({
        x: Math.min(Math.max(d.left + e.clientX - d.x, 80 - size.width), Math.max(0, window.innerWidth - 80)),
        y: Math.min(Math.max(d.top + e.clientY - d.y, 0), Math.max(0, window.innerHeight - 48)),
      });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [size.width]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      (document.activeElement as HTMLElement | null)?.blur();
      drag.current = { x: e.clientX, y: e.clientY, left: pos.x, top: pos.y };
      e.preventDefault();
    },
    [pos.x, pos.y],
  );

  const railWidth = Math.min(RAIL, Math.max(150, Math.round(size.width * 0.24)));

  return (
    <div className="settings-layer">
      <div
        className="settings-window"
        role="dialog"
        aria-label="Settings"
        style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      >
        <div className="settings-grip" onMouseDown={startDrag} aria-hidden>
          <i />
          <i />
          <i />
        </div>

        <header className="settings-head" onMouseDown={startDrag}>
          <span className="settings-head-dot" />
          <span className="settings-head-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-rail" aria-label="Settings sections" style={{ width: railWidth }}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-rail-row ${active === s.id ? "on" : ""}`}
                onClick={() => setActive(s.id)}
                aria-pressed={active === s.id}
                title={s.line}
              >
                <Icon name={s.icon} size={14} />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-pane">
            <div className="settings-pane-head">
              <h2>{section.label}</h2>
              <p>{section.line}</p>
            </div>
            <div className="settings-pane-body st-scroll" key={active}>
              <Pane
                section={active}
                settings={settings}
                patch={patch}
                prefs={prefs}
                setPrefs={setPrefs}
                info={info}
                agentName={agentName}
                onRenameAgent={onRenameAgent}
                onOpen={onOpen}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const SETTINGS_RAIL_WIDTH = RAIL;
