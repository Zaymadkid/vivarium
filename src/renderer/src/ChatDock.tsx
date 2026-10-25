import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRecord, ApprovalRequest, ChatMessage, ContextPack, ProviderId, Settings } from "../../shared/types";
import { PROVIDER_CATALOG } from "../../shared/providers";
import { decideApproval, useApprovals } from "./shell/live";
import { Icon } from "./shell/icons";
import { Tabs } from "./shell/Tabs";
import { Menu, MenuRow } from "./shell/ui";
import { usePrefs } from "./shell/prefs";
import { pushToast } from "./shell/toasts";
import { openFileViewer } from "./shell/FileViewer";
import { speakText, stopSpeech } from "./shell/speech";
import { createVoiceTurn } from "./shell/voiceTurn";
import { Diagram } from "./shell/DiagramView";
import { readDiagramText } from "./shell/diagram-model";

interface Activity {
  id: string;
  tool: string;
  ok?: boolean;
  detail?: string;
  /** The file a tool touched, so its row can offer "view file". */
  path?: string;
}

interface Props {
  agents: AgentRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAgentsChanged: () => void;
  onClose: () => void;
  onOpenDocuments?: () => void;
  /** Text transcribed by the voice pill. `send` speaks-and-sends in one move. */
  seed?: { text: string; at: number; send?: boolean } | null;
  /** Tells the window the transcript has been used, so a remount cannot replay it. */
  onSeedHandled?: () => void;
}

let nextLocalId = 0;

/**
 * Paths an answer mentions, so a reply that says "I wrote X" can offer the same
 * `view file` affordance as a tool row. Absolute Windows and POSIX paths only:
 * a bare filename has no folder to resolve against.
 */
const PATH_RE = /(?:[A-Za-z]:\\[^\n"'<>|:*?]+?\.\w{1,8}|\/(?:[\w.-]+\/)+[\w.-]+\.\w{1,8})/g;
function mentionedFiles(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(PATH_RE)) {
    const path = match[0].trim().replace(/[.,;:]+$/, "");
    seen.add(path);
  }
  return [...seen].slice(0, 3);
}

const IMAGE_RE = /(?:[A-Za-z]:\\[^\n"'<>|:*?]+?\.(?:png|jpe?g|webp|gif|svg)|\/(?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|webp|gif|svg))/gi;
function mentionedImages(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(IMAGE_RE)) {
    seen.add(match[0].trim().replace(/[.,;:]+$/, ""));
  }
  return [...seen].slice(0, 4);
}

/** True when the request is asking for a picture, not describing one. */
function asksForImage(text: string): boolean {
  return (
    /\b(?:generate|create|make|draw|render|paint|design|imagine)\b/i.test(text) &&
    /\b(?:image|picture|illustration|logo|art|artwork|photo|poster|wallpaper|icon)\b/i.test(text)
  );
}

/**
 * An image the answer points at. While a file is still being written the
 * component retries; once it loads, the red skeleton is replaced in place.
 */
function MessageImage({ path, live = false }: { path: string; live?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let tries = 0;
    let timer = 0;
    const load = () => {
      window.viv.files
        .image(path)
        .then((result) => {
          if (!stopped) setSrc(result.dataUrl);
        })
        .catch(() => {
          if (stopped) return;
          if (live && tries < 10) {
            tries += 1;
            timer = window.setTimeout(load, 900);
          } else {
            setFailed(true);
          }
        });
    };
    load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [path, live]);

  if (failed) {
    return (
      <div className="chat-image-failed">
        <Icon name="image" size={13} />
        <span>{path.split(/[\\/]/).pop()}</span>
        <button className="bubble-file" onClick={() => void window.viv.files.open(path)}>
          Open file
        </button>
      </div>
    );
  }

  return (
    <figure className={`chat-image ${src ? "ready" : "loading"}`}>
      {src ? (
        <img src={src} alt={path.split(/[\\/]/).pop() ?? "Generated image"} />
      ) : (
        <div className="chat-image-skeleton" aria-label="Image being created">
          <i className="chat-image-shimmer" />
          <Icon name="image" size={20} />
          <span>Bringing the image into view…</span>
        </div>
      )}
      <figcaption title={path}>
        <span>{path.split(/[\\/]/).pop()}</span>
        <button className="bubble-file" onClick={() => void window.viv.files.open(path)}>
          Open
        </button>
      </figcaption>
    </figure>
  );
}

function ImageSkeleton({ label = "Creating your image…" }: { label?: string }) {
  return (
    <div className="chat-image-skeleton standalone" aria-label={label}>
      <i className="chat-image-shimmer" />
      <Icon name="image" size={22} />
      <span>{label}</span>
      <em>The picture will appear here.</em>
    </div>
  );
}

/**
 * An answer, in the order it was written: prose bubbles and diagrams. A diagram
 * fence that is still open draws a skeleton rather than spilling JSON into the
 * conversation.
 */
function MessageBody({ content, caret, onAsk }: { content: string; caret?: boolean; onAsk: (question: string) => void }) {
  const { pieces, pending } = readDiagramText(content);
  const lastText = pieces.map((piece) => piece.kind).lastIndexOf("text");

  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === "text" ? (
          <div key={`t${index}`} className="bubble assistant">
            {piece.text.trim()}
            {caret && index === lastText && <span className="caret" />}
          </div>
        ) : (
          <div key={`d${index}`} className="chat-diagrams">
            <Diagram spec={piece.spec} onAsk={onAsk} />
          </div>
        ),
      )}
      {pending && <DiagramSkeleton />}
    </>
  );
}

function DiagramSkeleton() {
  return (
    <div className="chat-diagram-skeleton" aria-label="Diagram being assembled">
      <div className="dg-sketch">
        <i />
        <i />
        <i />
      </div>
      <span>Assembling the diagram…</span>
    </div>
  );
}

function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

export default function ChatDock({
  agents,
  selectedId,
  onSelect,
  onAgentsChanged,
  onClose,
  onOpenDocuments,
  seed,
  onSeedHandled,
}: Props) {
  const [prefs, setPrefs] = usePrefs();
  const [modeOpen, setModeOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [packId, setPackId] = useState<string | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  useEffect(() => {
    void Promise.all([
      window.viv.packs.list().catch(() => [] as ContextPack[]),
      window.viv.packs.attached().catch(() => null),
    ]).then(([list, active]) => {
      setPacks(list);
      setPackId(active);
    });
  }, []);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  /** runId → thumb. Hydrated from the store so a reload keeps the verdict. */
  const [ratings, setRatings] = useState<Record<string, "up" | "down">>({});
  // Every turn keeps its own buffer. The newest one is on screen; an older one
  // keeps working in the background and posts its answer when it lands.
  const runTexts = useRef(new Map<string, string>());
  const activeRunRef = useRef<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  // One queue shared with the floating stack: a card raised while this drawer
  // was shut is still here when it opens, and a CLI's request cannot be lost
  // between the two surfaces.
  const approvals = useApprovals();
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [awaitingImage, setAwaitingImage] = useState(false);
  const [imageMissing, setImageMissing] = useState(false);

  // Reference close is the entrance reversed (280 ms, x:420).
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 280);
  }, [onClose]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Automatic speech reads one short opening per turn. The getters see the
  // current settings, so flipping a switch applies to the next sentence, not
  // after a restart.
  const prefsLive = useRef(prefs);
  prefsLive.current = prefs;
  const voice = useRef<ReturnType<typeof createVoiceTurn> | null>(null);
  if (!voice.current) {
    voice.current = createVoiceTurn({
      enabled: () => prefsLive.current.speakReplies,
      full: () => prefsLive.current.speakFull,
    });
  }
  const stopVoice = useCallback(() => {
    stopSpeech();
    voice.current?.reset();
  }, []);
  const agent = useMemo(() => agents.find((a) => a.id === selectedId) ?? agents[0], [agents, selectedId]);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  // The provider and model a companion answers with. The record wins; Settings
  // is the fallback for a companion that has never been switched.
  const [settings, setSettings] = useState<Settings | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [customModel, setCustomModel] = useState("");
  useEffect(() => {
    void window.viv.settings.get().then(setSettings).catch(() => undefined);
  }, []);

  // Each body keeps its own conversation. Selecting a worker swaps the thread;
  // the orchestrator never inherits its workers' words.
  useEffect(() => {
    runTexts.current.clear();
    activeRunRef.current = null;
    stopVoice();
    setStreaming("");
    setActivities([]);
    setRunning(false);
    setRunId(null);
    void window.viv.chat.history(agent?.id).then(setMessages);
  }, [agent?.id]);

  useEffect(() => () => stopVoice(), [stopVoice]);
  useEffect(() => {
    if (!prefs.speakReplies) stopVoice();
  }, [prefs.speakReplies, stopVoice]);


  const speak = async (text: string) => {
    try {
      stopVoice();
      audio.current?.pause();
      await speakText(text);
    } catch (err) {
      pushToast({
        title: "Voice unavailable",
        body: String(err instanceof Error ? err.message : err).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
        tone: "bad",
      });
    }
  };

  useEffect(() => {
    const off = window.viv.chat.onEvent((event) => {
      switch (event.type) {
        case "reset": {
          // The mind changed its mind about what the answer is: the earlier text
          // was its own working-out, not the reply. Drop it, and stop reading it.
          runTexts.current.set(event.runId, "");
          if (activeRunRef.current === event.runId) setStreaming("");
          stopVoice();
          break;
        }
        case "delta": {
          const next = (runTexts.current.get(event.runId) ?? "") + event.text;
          runTexts.current.set(event.runId, next);
          if (activeRunRef.current === event.runId) setStreaming(next);
          // Speak alongside the writing, never after it: one short opening,
          // then silence while the rest arrives on screen. A background turn
          // stays silent.
          if (activeRunRef.current === event.runId) {
            voice.current?.delta(event.runId, next);
          }
          break;
        }
        case "tool-start": {
          const path = typeof event.args?.path === "string" ? event.args.path : undefined;
          setActivities((a) => [...a, { id: `${Date.now()}-${a.length}`, tool: event.tool, path }]);
          break;
        }
        case "tool-end":
          setActivities((a) =>
            a.map((x, i) =>
              i === a.length - 1 ? { ...x, ok: event.ok, detail: event.result.slice(0, 300) } : x,
            ),
          );
          break;
        case "dispatch":
          setActivities((a) => [...a, { id: `${Date.now()}-${a.length}`, tool: `Delegated to ${event.agentName}` }]);
          if (prefs.notifFinish) {
            pushToast({ title: `${event.agentName} is on it`, body: event.brief.slice(0, 140), tone: "info" });
          }
          break;
        case "report":
          // Only the worker's own drawer gets the words; the main thread gets a
          // notice, not a second voice talking over her.
          if (event.agentId === agent?.id) {
            setMessages((m) => [
              ...m,
              {
                id: `local-${++nextLocalId}`,
                role: "assistant",
                content: event.text,
                at: Date.now(),
                name: event.agentName,
              },
            ]);
          }
          if (prefs.notifFinish || !event.ok) {
            pushToast({
              title: event.ok ? `${event.agentName} finished` : `${event.agentName} hit a problem`,
              body: event.text.slice(0, 140),
              tone: event.ok ? "ok" : "bad",
            });
          }
          break;
        case "agent-state":
          onAgentsChanged();
          break;
        case "learned": {
          const parts = [
            event.memories ? `${event.memories} new fact${event.memories === 1 ? "" : "s"}` : "",
            event.skill ? `skill “${event.skill}”` : "",
          ].filter(Boolean);
          if (parts.length) {
            pushToast({ title: "Kept for next time", body: parts.join(" · "), tone: "ok" });
          }
          break;
        }
        case "final": {
          // The main process cleaned the finished answer: exact repeats and
          // stock closers are gone. Show the tidied text, not the raw stream.
          runTexts.current.set(event.runId, event.text);
          if (activeRunRef.current === event.runId) setStreaming(event.text);
          break;
        }
        case "done": {
          const text = runTexts.current.get(event.runId) ?? "";
          runTexts.current.delete(event.runId);
          const wasActive = activeRunRef.current === event.runId;
          if (wasActive) {
            activeRunRef.current = null;
            setStreaming("");
            setRunId(null);
            if (awaitingImage) {
              setAwaitingImage(false);
              setImageMissing(mentionedImages(text).length === 0);
            }
          }
          if (text.trim()) {
            setMessages((m) => [
              ...m,
              {
                id: `local-${++nextLocalId}`,
                role: "assistant",
                content: text,
                at: Date.now(),
                runId: event.runId,
              },
            ]);
            // If nothing has been said yet (a non-streaming provider), this
            // speaks the opening now. It never replays what was already said.
            if (wasActive) {
              voice.current?.done(event.runId, text);
            } else if (prefs.notifFinish) {
              pushToast({ title: "Background task finished", body: text.slice(0, 140), tone: "ok" });
            }
          }
          if (runTexts.current.size === 0) setRunning(false);
          break;
        }
        case "error": {
          const wasActive = activeRunRef.current === event.runId;
          runTexts.current.delete(event.runId);
          if (wasActive) {
            activeRunRef.current = null;
            setStreaming("");
            setRunId(null);
            setAwaitingImage(false);
            stopVoice();
          }
          if (wasActive) setError(event.message);
          else pushToast({ title: "A background task failed", body: event.message.slice(0, 140), tone: "bad" });
          if (runTexts.current.size === 0) setRunning(false);
          break;
        }
      }
    });
    return off;
  }, [onAgentsChanged, prefs.speakReplies, prefs.speakFull, prefs.notifFinish, agent?.id, awaitingImage]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, activities, approvals]);

  /** One turn, from any source: the composer, or a clip that was just heard. */
  const deliver = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || !agent) return;

    // Talking while she works: the previous turn is NOT cancelled. It carries on
    // in the background, silent, and posts its answer when it is done. The new
    // message becomes the live one. Sending is also the natural barge-in: her
    // current sentence stops before the next one starts.
    stopVoice();
    setDraft("");
    setError(null);
    setActivities([]);
    setStreaming("");
    setAwaitingImage(asksForImage(text));
    setImageMissing(false);
    activeRunRef.current = "pending";
    setMessages((m) => [...m, { id: `local-${++nextLocalId}`, role: "user", content: text, at: Date.now() }]);
    setRunning(true);
    try {
      const { runId: id } = await window.viv.chat.send(agent.id, text);
      activeRunRef.current = id;
      setRunId(id);
      setStreaming(runTexts.current.get(id) ?? "");
    } catch (err) {
      activeRunRef.current = null;
      setError((err as Error).message);
      setRunning(false);
    }
  }, [agent]);

  const send = useCallback(() => deliver(draft), [deliver, draft]);

  // Push-to-talk sends straight away. Typed transcripts still land in the
  // composer, so a misheard word can be fixed before it is sent.
  const lastSeed = useRef(0);
  useEffect(() => {
    if (!seed?.text || lastSeed.current === seed.at) return;
    lastSeed.current = seed.at;
    if (seed.send) void deliver(seed.text);
    else setDraft((d) => (d.trim() ? `${d.trim()} ${seed.text}` : seed.text));
    onSeedHandled?.();
  }, [seed?.at, seed?.text, seed?.send, deliver, onSeedHandled]);

  const cancel = useCallback(async () => {
    // Stop is for the turn you are waiting on; if nothing is live, it stops the
    // background work instead of leaving it orphaned.
    stopVoice();
    const ids = runId ? [runId] : [...runTexts.current.keys()];
    for (const id of ids) await window.viv.chat.cancel(id);
  }, [runId, stopVoice]);

  const decide = useCallback(
    async (request: ApprovalRequest, decision: "allow" | "always" | "deny") => {
      await decideApproval(request, decision);
    },
    [],
  );

  // A thumb is stored against the run, so the approach that produced this
  // answer gains or loses a point. Clicking the same one again takes it back.
  const rate = useCallback(
    async (id: string, value: "up" | "down") => {
      const next = ratings[id] === value ? null : value;
      try {
        await window.viv.feedback.rate(id, next);
        setRatings((previous) => {
          const copy = { ...previous };
          if (next) copy[id] = next;
          else delete copy[id];
          return copy;
        });
        pushToast({
          title: next === "up" ? "Good — that approach gains a point" : next === "down" ? "Missed — that approach loses a point" : "Verdict cleared",
          body: next ? "It shapes which way she tries next." : undefined,
          tone: next === "down" ? "info" : "ok",
        });
      } catch (err) {
        pushToast({ title: "Could not save that", body: (err as Error).message, tone: "bad" });
      }
    },
    [ratings],
  );

  // The store already knows what was rated; ask once so a relaunch shows it.
  useEffect(() => {
    void window.viv.usage
      .get()
      .then((report) => {
        const map: Record<string, "up" | "down"> = {};
        for (const run of report.runs) if (run.feedback) map[run.id] = run.feedback;
        setRatings(map);
      })
      .catch(() => undefined);
  }, []);

  const clear = useCallback(async () => {
    await window.viv.chat.clear();
    setMessages([]);
    setStreaming("");
    setActivities([]);
    setError(null);
  }, []);

  // A diagram node can become the next question, so the composer is where the
  // detail ends instead of a dead end.
  const askAbout = useCallback((question: string) => {
    setDraft((current) => (current.trim() ? `${current.trim()} ${question}` : question));
    composer.current?.focus();
  }, []);

  const switchModel = useCallback(
    async (provider: ProviderId, model: string) => {
      if (!agent) return;
      const next = agents.map((entry) => (entry.id === agent.id ? { ...entry, provider, model } : entry));
      await window.viv.agents.save(next);
      setModelOpen(false);
      setCustomModel("");
      onAgentsChanged();
      const label = PROVIDER_CATALOG.find((entry) => entry.id === provider)?.label ?? provider;
      pushToast({ title: "Model switched", body: `${label} · ${model}`, tone: "ok" });
    },
    [agents, agent, onAgentsChanged],
  );

  if (!agent) return null;
  const activeProvider = agent.provider ?? settings?.provider ?? "mock";
  const activeModel = agent.model || settings?.model || "";
  const activeProviderLabel = PROVIDER_CATALOG.find((entry) => entry.id === activeProvider)?.label ?? activeProvider;

  return (
    <aside
      className={`chat-drawer${closing ? " closing" : ""}`}
      aria-label="Conversation"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const count = e.dataTransfer.files.length;
        if (count > 0) {
          pushToast({
            title: `${count} ${count === 1 ? "file" : "files"} not attached`,
            body: "This build has no attachment bridge. Drop files into a skill or a document instead.",
            tone: "info",
          });
        }
      }}
    >
      {dragging && <div className="chat-drop">Drop to attach — not wired in this build</div>}
      <header className="chat-head">
        <div className="chat-who">
          <span className={`dotstate ${agent.state}`} />
          <span className="chat-name">{agent.name}</span>
          <span className="menu-anchor">
            <button
              className="chat-mode"
              onClick={() => setModeOpen((v) => !v)}
              aria-expanded={modeOpen}
              title="Who decides before a companion acts"
            >
              Actions: {prefs.approvalMode === "auto" ? "auto" : "manual"}
              <Icon name="down" size={9} />
            </button>
            {modeOpen && (
              <Menu onClose={() => setModeOpen(false)} width={272}>
                <div className="menu-head">
                  <span>Who decides</span>
                </div>
                <MenuRow
                  active={prefs.approvalMode === "manual"}
                  hint={prefs.approvalMode === "manual" ? "on" : undefined}
                  onClick={() => {
                    setPrefs({ approvalMode: "manual" });
                    setModeOpen(false);
                  }}
                >
                  Manual
                  <span className="menu-note">Companions ask before acting.</span>
                </MenuRow>
                <MenuRow
                  active={prefs.approvalMode === "auto"}
                  hint={prefs.approvalMode === "auto" ? "on" : undefined}
                  onClick={() => {
                    setPrefs({ approvalMode: "auto" });
                    setModeOpen(false);
                  }}
                >
                  Auto
                  <span className="menu-note">Companions act on their own.</span>
                </MenuRow>
              </Menu>
            )}
          </span>
          <span className="menu-anchor model-anchor">
            <button
              className="chat-mode chat-model"
              onClick={() => setModelOpen((value) => !value)}
              aria-expanded={modelOpen}
              title="Switch which model answers this conversation"
            >
              <Icon name="cpu" size={9} />
              <span className="chat-model-label">
                {activeProviderLabel.replace(/ CLI$/, "")} · {activeModel || "default"}
              </span>
              <Icon name="down" size={9} />
            </button>
            {modelOpen && (
              <Menu onClose={() => setModelOpen(false)} width={296}>
                <div className="menu-head">
                  <span>Answer with</span>
                </div>
                <div className="model-scroll">
                  {PROVIDER_CATALOG.filter((entry) => entry.id !== "mock").map((entry) => {
                    const models = entry.models?.length ? entry.models : [entry.defaultModel];
                    const current = entry.id === activeProvider;
                    return (
                      <div key={entry.id} className="model-group">
                        <div className="model-provider">{entry.label}</div>
                        {models.map((model) => {
                          const on = current && model === activeModel;
                          return (
                            <MenuRow
                              key={model}
                              active={on}
                              hint={on ? "on" : undefined}
                              onClick={() => void switchModel(entry.id, model)}
                            >
                              {model}
                            </MenuRow>
                          );
                        })}
                        {current && activeModel && !models.includes(activeModel) && (
                          <MenuRow active hint="on" onClick={() => void switchModel(entry.id, activeModel)}>
                            {activeModel}
                          </MenuRow>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="model-custom">
                  <input
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder={`Custom model for ${activeProviderLabel.replace(/ CLI$/, "")}`}
                    aria-label="Custom model id"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && customModel.trim()) {
                        event.preventDefault();
                        void switchModel(activeProvider, customModel.trim());
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!customModel.trim()}
                    onClick={() => void switchModel(activeProvider, customModel.trim())}
                  >
                    Use
                  </button>
                </div>
                <div className="menu-note">Switching changes the next reply in this conversation, not the others.</div>
              </Menu>
            )}
          </span>
        </div>
        <div className="chat-actions">
          <button
            className="icon-btn sm"
            title="Pop out into its own window"
            aria-label="Pop out"
            onClick={() =>
              pushToast({
                title: "Pop-out needs a second window",
                body: "This build owns one renderer window, so the drawer stays here.",
                tone: "info",
              })
            }
          >
            <Icon name="external" size={13} />
          </button>
          <button className="icon-btn sm" onClick={() => void clear()} title="Clear the thread" aria-label="Clear thread">
            <Icon name="refresh" size={13} />
          </button>
          <button className="icon-btn sm" onClick={close} title="Close" aria-label="Close conversation">
            <Icon name="close" size={13} />
          </button>
        </div>
      </header>

      <div className="chat-tabs">
        <Tabs
          label="Companions in this conversation"
          value={agent.id}
          onChange={onSelect}
          items={agents.map((a) => ({ value: a.id, label: a.name }))}
        />
      </div>

      <div className="chat-body" ref={scroller}>
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <p className="chat-empty-title">She is listening.</p>
            <p>Ask {agent.name} for anything. Everything stays on this machine.</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`bubble-wrap ${m.role}`}>
            {m.role === "assistant" ? (
              <MessageBody content={m.content} onAsk={askAbout} />
            ) : (
              <div className={`bubble ${m.role}`}>{m.content}</div>
            )}
            {m.role === "assistant" && mentionedImages(m.content).length > 0 && (
              <div className="chat-images">
                {mentionedImages(m.content).map((path) => (
                  <MessageImage key={path} path={path} />
                ))}
              </div>
            )}
            {m.role === "assistant" &&
              mentionedFiles(m.content).length > 0 && (
                <div className="bubble-files">
                  {mentionedFiles(m.content).map((path) => (
                    <button key={path} className="bubble-file" onClick={() => openFileViewer(path)} title={path}>
                      <Icon name="file" size={11} />
                      View {path.split(/[\\/]/).pop()}
                    </button>
                  ))}
                </div>
              )}
            {m.role === "assistant" && (
              <div className="bubble-actions">
                <button className="bubble-file" onClick={() => void speak(m.content)} title="Play this aloud">
                  <Icon name="wave" size={11} />
                  Play
                </button>
                {m.runId && (
                  <>
                    <button
                      className={`bubble-file ${ratings[m.runId] === "up" ? "rated" : ""}`}
                      aria-pressed={ratings[m.runId] === "up"}
                      title="This answer was useful"
                      onClick={() => void rate(m.runId!, "up")}
                    >
                      <Icon name="check" size={11} />
                      Good
                    </button>
                    <button
                      className={`bubble-file ${ratings[m.runId] === "down" ? "rated down" : ""}`}
                      aria-pressed={ratings[m.runId] === "down"}
                      title="This answer missed"
                      onClick={() => void rate(m.runId!, "down")}
                    >
                      <Icon name="close" size={11} />
                      Missed
                    </button>
                  </>
                )}
              </div>
            )}
            <span className="bubble-time">{ago(m.at)}</span>
          </div>
        ))}

        {activities.length > 0 && (
          <div className="chat-activity">
            {activities.map((a) => (
              <details key={a.id} className="tool-row">
                <summary>
                  <span
                    className="actdot"
                    style={{
                      background: a.ok === undefined ? undefined : a.ok ? "var(--live)" : "var(--bad)",
                    }}
                  />
                  <span className="actname">{a.tool}</span>
                  <span className="actstate">
                    {a.ok === undefined ? "running" : a.ok ? "done" : "failed"}
                  </span>
                  <Icon name="down" size={10} />
                </summary>
                <pre>{a.detail ?? "No result yet."}</pre>
                {a.path && (
                  <button className="btn sm" onClick={() => openFileViewer(a.path)}>
                    <Icon name="file" size={12} />
                    View file
                  </button>
                )}
              </details>
            ))}
          </div>
        )}

        {approvals.map((req) => (
          <div key={req.requestId} className="approval">
            <div className="approval-head">
              <span className={`cchip ${req.danger}`}>{req.danger}</span>
              <strong>{req.tool}</strong>
            </div>
            <pre className="approval-body">{req.summary || JSON.stringify(req.args, null, 2)}</pre>
            <div className="approval-actions">
              <button className="primary" onClick={() => void decide(req, "allow")}>
                Allow once
              </button>
              <button onClick={() => void decide(req, "always")}>Always allow {req.tool}</button>
              <button className="danger" onClick={() => void decide(req, "deny")}>
                Deny
              </button>
            </div>
          </div>
        ))}

        {running && !streaming && (
          <div className="bubble-wrap assistant">
            {awaitingImage ? (
              <ImageSkeleton />
            ) : (
              <div className="bubble assistant">
                <span className="typing" aria-label={`${agent.name} is thinking`}>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
        )}

        {streaming && (
          <div className="bubble-wrap assistant">
            <MessageBody content={streaming} caret onAsk={askAbout} />
            {awaitingImage && mentionedImages(streaming).length === 0 && <ImageSkeleton />}
            {mentionedImages(streaming).length > 0 && (
              <div className="chat-images">
                {mentionedImages(streaming).map((path) => (
                  <MessageImage key={path} path={path} live />
                ))}
              </div>
            )}
          </div>
        )}

        {imageMissing && (
          <div className="chat-image-missing">
            <Icon name="warn" size={12} />
            The reply did not point at an image file. Ask for it again, or ask where it saved the file.
          </div>
        )}

        {error && <div className="chat-error">{error}</div>}
      </div>

      <footer className="chat-foot">
        <div className="chat-pack">
          <span className="menu-anchor">
            <button
              className={`pack-chip ${packId ? "on" : ""}`}
              title="Context pack — included in every turn while attached"
              onClick={async () => {
                if (!packs.length) {
                  const [list, active] = await Promise.all([
                    window.viv.packs.list().catch(() => [] as ContextPack[]),
                    window.viv.packs.attached().catch(() => null),
                  ]);
                  setPacks(list);
                  setPackId(active);
                }
                setPackOpen((v) => !v);
              }}
            >
              <span className="pack-glyph">◈</span>
              {packId ? packs.find((p) => p.id === packId)?.name ?? "Context pack" : "Context pack"}
            </button>
            {packOpen && (
              <Menu
                onClose={() => setPackOpen(false)}
                align="left"
                width={240}
              >
                <MenuRow
                  active={!packId}
                  hint={!packId ? "on" : undefined}
                  onClick={async () => {
                    setPackOpen(false);
                    setPackId(await window.viv.packs.attach(null));
                  }}
                >
                  None
                </MenuRow>
                {packs.map((pack) => (
                  <MenuRow
                    key={pack.id}
                    active={packId === pack.id}
                    hint={packId === pack.id ? "on" : undefined}
                    onClick={async () => {
                      setPackOpen(false);
                      setPackId(await window.viv.packs.attach(pack.id));
                    }}
                  >
                    {pack.name}
                  </MenuRow>
                ))}
                <div className="menu-note">Settings → Documents edits packs.</div>
              </Menu>
            )}
          </span>
        </div>
        <div className="composer">
          <span className="menu-anchor">
            <button
              className="composer-add"
              title="Attach"
              aria-label="Attach"
              aria-expanded={attachOpen}
              onClick={() => setAttachOpen((v) => !v)}
            >
              +
            </button>
            {attachOpen && (
              <Menu onClose={() => setAttachOpen(false)} align="left" width={196}>
                <MenuRow
                  icon="doc"
                  onClick={() => {
                    setAttachOpen(false);
                    onOpenDocuments?.();
                  }}
                >
                  Documents
                </MenuRow>
                <MenuRow
                  icon="image"
                  onClick={() => {
                    setAttachOpen(false);
                    pushToast({
                      title: "Images are not attachable yet",
                      body: "The renderer has no image bridge in this build.",
                      tone: "info",
                    });
                  }}
                >
                  Images
                </MenuRow>
                <MenuRow
                  icon="file"
                  onClick={() => {
                    setAttachOpen(false);
                    pushToast({
                      title: "Code files are not attachable yet",
                      body: "Use Hands to grant a folder, then ask her to read it.",
                      tone: "info",
                    });
                  }}
                >
                  Code
                </MenuRow>
                <div className="menu-note">Nothing leaves this machine when you attach.</div>
              </Menu>
            )}
          </span>
          <textarea
            ref={composer}
            value={draft}
            placeholder={`Message ${agent.name}…`}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {running ? (
            <>
              {draft.trim() && (
                <button className="composer-send" onClick={() => void send()} title="Send — interrupts the current turn">
                  ↑
                </button>
              )}
              <button className="composer-send stop" onClick={() => void cancel()} title="Stop">
                ■
              </button>
            </>
          ) : (
            <button className="composer-send" onClick={() => void send()} disabled={!draft.trim()} title="Send">
              ↑
            </button>
          )}
        </div>
        <div className="chat-caption">
          {running ? `${agent.name} is working…` : "Enter to send · Shift+Enter for a new line"}
        </div>
      </footer>
    </aside>
  );
}
