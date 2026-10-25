import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRecord, ApprovalRequest, ChatMessage, Settings } from "../../shared/types";
import { PROVIDER_CATALOG } from "../../shared/providers";
import { Icon } from "./shell/icons";
import { decideApproval, useApprovals } from "./shell/live";
import { useRecorder } from "./shell/recorder";
import { onSpeakingChange, stopSpeech } from "./shell/speech";
import { createVoiceTurn } from "./shell/voiceTurn";
import { useLiveVoice } from "./shell/conversation";
import { usePrefs } from "./shell/prefs";

/**
 * THE KNOT.
 *
 * Nus' defining surface, brought into Vivarium: a small always-on-top companion
 * that is one keystroke away from listening. It is the same runtime, the same
 * conversation and the same approvals as the main window — not a second app and
 * not a second agent. Speech and text both go through `chat.send`.
 */

/** Diagrams are drawn in the main chat; the overlay shows a marker, not JSON. */
function spokenText(text: string) {
  return text
    .replace(/```(?:diagram|flowchart|chart)[\s\S]*?```/gi, "A diagram is open in the main chat. ")
    // The Knot is a conversation, not a document: strip the markers a person
    // would not say out loud instead of showing raw ** and backticks.
    .replace(/```[\s\S]*?```/g, "A code block is in the main chat. ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "· ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1");
}

const GLYPH = (
  <svg viewBox="0 0 48 48" aria-hidden="true" className="knot-glyph">
    <circle cx="19" cy="24" r="11.5" />
    <circle cx="29" cy="24" r="11.5" />
    <circle cx="24" cy="24" r="2.2" className="knot-core" />
  </svg>
);

export function Overlay() {
  const [prefs, setPrefs] = usePrefs();
  const approvals = useApprovals();
  const recorder = useRecorder();
  const liveOn = prefs.liveConversation;
  const [speakingNow, setSpeakingNow] = useState(false);
  /** Things said while a job was running that the run could not take yet. */
  const queued = useRef<string[]>([]);

  useEffect(() => onSpeakingChange(setSpeakingNow), []);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const runTexts = useRef(new Map<string, string>());
  const ownRun = useRef<string | null>(null);
  const recorderState = useRef(recorder.state);
  recorderState.current = recorder.state;
  const prefsLive = useRef(prefs);
  prefsLive.current = prefs;
  const voice = useRef<ReturnType<typeof createVoiceTurn> | null>(null);
  if (!voice.current) {
    voice.current = createVoiceTurn({
      enabled: () => prefsLive.current.speakReplies,
      // A live conversation reads the whole reply, not the opening line: that
      // clipped reading is what made her sound like a notification.
      full: () => prefsLive.current.speakFull || prefsLive.current.liveConversation,
    });
  }

  // The person's own voice, without a key: the microphone stays open while live
  // mode is on, and a sentence is sent the moment they stop talking.
  const liveHandler = useRef<(text: string) => void>(() => undefined);
  const live = useLiveVoice({
    active: prefs.liveConversation,
    onUtterance: (text) => liveHandler.current(text),
    onBargeIn: () => {
      // Stop the clip and hold the rest of this turn back: they are talking.
      voice.current?.silence();
      stopSpeech();
    },
    onNote: (text) => setNote(text),
  });

  const agent = useMemo(
    () => agents.find((entry) => entry.isOrchestrator) ?? agents[0],
    [agents],
  );

  const providerId = agent?.provider ?? settings?.provider ?? "codebuddy";
  const provider = PROVIDER_CATALOG.find((entry) => entry.id === providerId);
  const model = agent?.model || settings?.model || "default";
  const modelLabel = `${(provider?.label ?? providerId).replace(/ CLI$/, "")} · ${model}`;

  const stopVoice = useCallback(() => {
    stopSpeech();
    voice.current?.reset();
  }, []);

  useEffect(() => () => stopVoice(), [stopVoice]);

  // A conversation starts when the person starts it. If the app closed while
  // live mode was on, the microphone does not open by itself on next launch.
  useEffect(() => {
    if (prefs.liveConversation) setPrefs({ liveConversation: false });
    // First mount only: this is a launch guard, not a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hide = useCallback(() => {
    stopVoice();
    // Hiding the companion closes the microphone with it. A conversation that
    // keeps listening after it is gone would be a bug, not a feature.
    setPrefs({ liveConversation: false });
    void window.viv.overlay.hide();
  }, [setPrefs, stopVoice]);

  useEffect(() => {
    void window.viv.agents.list().then(setAgents).catch(() => undefined);
    void window.viv.settings
      .get()
      .then((next) => {
        setSettings(next);
        document.documentElement.style.setProperty("--companion", next.accent);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!agent?.id) return;
    void window.viv.chat.history(agent.id).then(setMessages).catch(() => undefined);
  }, [agent?.id]);

  useEffect(() => {
    // Island mode is a different window shape, not a different surface: the same
    // thread and microphone, a slim bar at the top of the screen.
    if (prefs.islandMode && !expanded) {
      void window.viv.overlay.island(true);
      return;
    }
    void window.viv.overlay.resize(expanded ? 396 : 96, expanded ? 620 : 118);
  }, [expanded, prefs.islandMode]);

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, streaming, approvals, expanded]);

  useEffect(() => {
    const off = window.viv.chat.onEvent((event) => {
      switch (event.type) {
        case "reset": {
          runTexts.current.set(event.runId, "");
          if (ownRun.current === event.runId) {
            setStreaming("");
            // The mind changed its mind about what to say. Finish the sentence
            // already in the air, then read the new text from its start.
            voice.current?.restart(event.runId);
          } else {
            stopVoice();
          }
          break;
        }
        case "delta": {
          const next = (runTexts.current.get(event.runId) ?? "") + event.text;
          runTexts.current.set(event.runId, next);
          if (ownRun.current === event.runId) {
            setStreaming(next);
            setActivity(null);
            voice.current?.delta(event.runId, next);
          }
          break;
        }
        case "tool-start":
          if (ownRun.current === event.runId) setActivity(event.tool);
          break;
        case "tool-end":
          if (ownRun.current === event.runId) setActivity(null);
          break;
        case "final": {
          runTexts.current.set(event.runId, event.text);
          if (ownRun.current === event.runId) setStreaming(event.text);
          break;
        }
        case "done": {
          const text = runTexts.current.get(event.runId) ?? "";
          runTexts.current.delete(event.runId);
          const mine = ownRun.current === event.runId;
          if (mine) {
            ownRun.current = null;
            setRunning(false);
            setStreaming("");
            setRunId(null);
            setActivity(null);
            if (text.trim()) {
              setMessages((rows) => [
                ...rows,
                { id: `local-${Date.now()}`, role: "assistant", content: text, at: Date.now() },
              ]);
            }
            voice.current?.done(event.runId, text);
            // Something was said while this job was running and could not reach
            // it. It is answered now, in the same conversation.
            const waiting = queued.current.shift();
            if (waiting) window.setTimeout(() => sendRef.current(waiting, true), 250);
          }
          break;
        }
        case "error":
          if (ownRun.current === event.runId) {
            ownRun.current = null;
            setRunning(false);
            setStreaming("");
            setRunId(null);
            setActivity(null);
            stopVoice();
            setError(event.message);
          }
          break;
        case "learned": {
          const parts = [
            event.memories ? `${event.memories} fact${event.memories === 1 ? "" : "s"}` : "",
            event.skill ? `skill “${event.skill}”` : "",
          ].filter(Boolean);
          if (parts.length) setNote(`Kept ${parts.join(" · ")} for next time.`);
          break;
        }
      }
    });
    return off;
  }, [stopVoice, agent?.id]);

  const talkRef = useRef<() => Promise<void>>(async () => undefined);
  const sendRef = useRef<(text: string, fromVoice?: boolean) => void>(() => undefined);
  // Attached once. Reading refs at event time keeps a re-rendering recorder hook
  // from tearing down and re-adding the listener while a key is being pressed.
  const keyRef = useRef({
    cancel: () => undefined as void,
    hide: () => undefined as void,
    hush: () => undefined as void,
    talk: () => undefined as void,
  });
  const liveOnRef = useRef(prefs.liveConversation);
  liveOnRef.current = prefs.liveConversation;

  useEffect(() => {
    let pressedAt = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const typing = Boolean(target?.closest("input, textarea, [contenteditable=true]"));
      if (event.key === "Escape") {
        event.preventDefault();
        if (recorderState.current === "listening") keyRef.current.cancel();
        else keyRef.current.hide();
        return;
      }
      if (event.code === "Space" && !typing && !event.repeat) {
        event.preventDefault();
        // While live, the microphone is already listening: Space means “stop
        // talking for a second”, which is the one thing a voice cannot do itself.
        if (liveOnRef.current) {
          keyRef.current.hush();
          return;
        }
        pressedAt = Date.now();
        keyRef.current.talk();
      }
    };
    // Hold to talk: letting go of a held key ends the clip. A quick tap leaves
    // the microphone open for a longer thought, and the next tap ends it.
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !pressedAt) return;
      const held = Date.now() - pressedAt;
      pressedAt = 0;
      if (held >= 350 && recorderState.current === "listening") keyRef.current.talk();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const sendText = useCallback(
    async (raw: string, fromVoice = false) => {
      const text = raw.trim();
      if (!text || !agent) return;
      stopVoice();
      setDraft("");
      setError(null);
      setNote(null);
      setStreaming("");
      setActivity(null);
      setExpanded(true);

      // Reflexes first. A spoken “open Notepad, type hello” should land before a
      // model round trip, and a request that does not match every clause falls
      // through to the companion with its words intact.
      if (fromVoice) {
        try {
          const outcome = await window.viv.voice.action(text);
          if (outcome.handled) {
            setNote(outcome.note ?? "Done.");
            return;
          }
        } catch {
          // A failed reflex is not a failed turn; let her handle it.
        }
      }
      setMessages((rows) => [
        ...rows,
        { id: `local-${Date.now()}`, role: "user", content: text, at: Date.now() },
      ]);
      setRunning(true);
      ownRun.current = "pending";
      try {
        // `fromVoice` tells the runtime this turn is speech, so the answer comes
        // back in the shape of speech instead of a document.
        const { runId: id } = await window.viv.chat.send(agent.id, text, fromVoice);
        ownRun.current = id;
        setRunId(id);
        setStreaming(runTexts.current.get(id) ?? "");
      } catch (err) {
        ownRun.current = null;
        setRunning(false);
        setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      }
    },
    [agent, stopVoice],
  );

  sendRef.current = (text, fromVoice) => void sendText(text, fromVoice);
  // The talk key opens a conversation, not a walkie-talkie. One press and the
  // microphone stays open until they end it; holding Space inside the window is
  // still the one-shot push-to-talk for a single thought.
  const toggleLiveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    return window.viv.overlay.onTalk(() => toggleLiveRef.current());
  }, []);

  /**
   * THE PERSON SPOKE.
   *
   * If a job is running, the words belong to that job, not to a second one.
   * Where the mind can take a message mid-flight it lands in the running turn;
   * a CLI runs one process per turn, so there the words wait and are answered
   * the moment the step finishes instead of throwing the work away.
   */
  liveHandler.current = (raw) => {
    const text = raw.trim();
    if (!text) return;
    setExpanded(true);
    setError(null);
    const run = ownRun.current;
    if (running && run && run !== "pending") {
      setMessages((rows) => [
        ...rows,
        { id: `local-${Date.now()}`, role: "user", content: text, at: Date.now() },
      ]);
      if (provider?.kind === "cli") {
        queued.current.push(text);
        setNote("Heard you. I'll answer as soon as this step finishes.");
        return;
      }
      void window.viv.chat.steer(run, text).then((ok) => {
        if (!ok) void sendText(text, true);
      });
      return;
    }
    void sendText(text, true);
  };

  const talk = useCallback(async () => {
    setExpanded(true);
    setError(null);
    // In a live conversation the microphone is already open; the button ends it.
    if (prefs.liveConversation) {
      setPrefs({ liveConversation: false });
      stopVoice();
      return;
    }
    if (recorderState.current === "listening") {
      const text = await recorder.finish();
      if (text) await sendText(text, true);
      return;
    }
    if (recorderState.current !== "idle") return;
    await recorder.begin();
  }, [prefs.liveConversation, recorder, sendText, setPrefs, stopVoice]);

  /** Start (or end) the hands-free conversation. */
  const toggleLive = useCallback(() => {
    setExpanded(true);
    if (prefs.liveConversation) {
      setPrefs({ liveConversation: false });
      stopVoice();
      return;
    }
    // A silent conversation is not a conversation.
    recorder.cancel();
    setPrefs({ liveConversation: true, speakReplies: true });
    setError(null);
    setNote(null);
  }, [prefs.liveConversation, recorder, setPrefs, stopVoice]);

  const hush = useCallback(() => {
    voice.current?.silence();
    stopSpeech();
  }, []);

  talkRef.current = talk;
  toggleLiveRef.current = toggleLive;
  keyRef.current = {
    cancel: recorder.cancel,
    hide,
    hush,
    talk: () => void talkRef.current(),
  };

  // Point-and-ask is owned here so the answer streams in this window and the
  // same voice reads it, instead of starting a silent background turn.
  const pointRef = useRef<(prompt: string) => void>(() => undefined);
  pointRef.current = (prompt) => {
    void sendText(prompt);
  };

  useEffect(() => {
    const offPoint = window.viv.overlay.onPoint(({ prompt }) => pointRef.current(prompt));
    const offNotice = window.viv.overlay.onNotice((text) => {
      setNote(text);
      setExpanded(true);
    });
    return () => {
      offPoint();
      offNotice();
    };
  }, []);

  const cancelRun = useCallback(async () => {
    stopVoice();
    const target = runId ?? ownRun.current;
    if (target && target !== "pending") await window.viv.chat.cancel(target);
    setRunning(false);
    setStreaming("");
    setRunId(null);
    ownRun.current = null;
    setActivity(null);
  }, [runId, stopVoice]);

  const decide = useCallback(async (request: ApprovalRequest, decision: "allow" | "always" | "deny") => {
    await decideApproval(request, decision);
  }, []);

  const submit = () => {
    if (draft.trim()) void sendText(draft);
  };

  const listening = liveOn ? live.state !== "off" : recorder.state === "listening";
  const meter = liveOn ? live.level : recorder.level;
  const micState = liveOn
    ? live.state === "transcribing"
      ? "transcribing"
      : live.state === "off"
        ? ""
        : "listening"
    : recorder.state;
  const status = listening
    ? live.state === "hearing"
      ? "Hearing you"
      : "Listening"
    : recorder.state === "transcribing" || live.state === "transcribing"
      ? "Writing it down"
      : speakingNow
        ? "Speaking"
        : running
          ? "Working"
          : "On screen";
  const modelReady = Boolean(agent);

  const islandBar = prefs.islandMode && !expanded;

  const orb = (
    <div className={`knot-collapsed${listening ? " listening" : ""}${running ? " thinking" : ""}`}>
      <span className="knot-grip" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <button
        type="button"
        className="knot-orb"
        onClick={() => setExpanded(true)}
        title={`Open ${agent?.name ?? "companion"} — Ctrl+Shift+Space to talk`}
        aria-label="Open the on-screen companion"
      >
        {GLYPH}
        <span className={`knot-dot ${listening ? "live" : running ? "busy" : ""}`} />
        {listening && <span className="knot-ring" />}
      </button>
      {listening && (
        <span className="knot-orb-meter" aria-hidden>
          {[0, 1, 2].map((index) => (
            <i key={index} style={{ height: `${4 + meter * (index === 1 ? 16 : 11)}px` }} />
          ))}
        </span>
      )}
    </div>
  );

  if (islandBar) {
    return (
      <div className="knot island-mode">
        <div className={`island-bar${listening ? " listening" : ""}`}>
          <button
            type="button"
            className="island-mark"
            onClick={() => setExpanded(true)}
            title={`Open ${agent?.name ?? "companion"}`}
            aria-label="Open the on-screen companion"
          >
            {GLYPH}
            <span className={`knot-dot ${listening ? "live" : running ? "busy" : ""}`} />
          </button>

          <div className="island-who">
            <strong>{agent?.name ?? "Companion"}</strong>
            <span>
              <i className={`knot-state ${listening ? "live" : running ? "busy" : ""}`} />
              {status}
            </span>
          </div>

          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={listening ? "Listening…" : `Ask ${agent?.name ?? "her"}…`}
            aria-label="Message your companion"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />

          <button
            type="button"
            className={`island-icon mic ${micState}`}
            onClick={() => void talk()}
            title={liveOn ? "End the conversation" : listening ? "Stop and send" : "Talk"}
            aria-label={liveOn ? "End the live conversation" : listening ? "Stop recording and send" : "Start talking"}
          >
            <Icon name={listening ? "pause" : "mic"} size={13} />
          </button>

          {running ? (
            <button type="button" className="island-icon stop" onClick={() => void cancelRun()} title="Stop" aria-label="Stop">
              ■
            </button>
          ) : (
            <button
              type="button"
              className="island-icon send"
              onClick={submit}
              disabled={!draft.trim()}
              title="Send"
              aria-label="Send"
            >
              ↑
            </button>
          )}

          <button type="button" className="island-icon" onClick={hide} title="Hide (Esc)" aria-label="Hide the overlay">
            <Icon name="close" size={11} />
          </button>

          {approvals.length > 0 && (
            <span className="island-approvals" title={`${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting`}>
              {approvals.length}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`knot${expanded ? " open" : ""}`}>
      {!expanded && orb}

      {expanded && (
        <section className="knot-panel" aria-label="On-screen companion">
          <header className="knot-head">
            <button
              type="button"
              className="knot-mark"
              onClick={() => setExpanded(false)}
              title="Collapse to the orb"
              aria-label="Collapse to the orb"
            >
              {GLYPH}
            </button>
            <div className="knot-who">
              <strong>{agent?.name ?? "Companion"}</strong>
              <span>
                <i className={`knot-state ${listening ? "live" : running ? "busy" : ""}`} />
                {status}
              </span>
            </div>
            <button
              type="button"
              className={`knot-live${liveOn ? " on" : ""}`}
              onClick={toggleLive}
              title={
                liveOn
                  ? "Live conversation — press to end"
                  : "Live conversation — talk back and forth without pressing anything"
              }
              aria-pressed={liveOn}
            >
              <i />
              Live
            </button>
            <span className="knot-model" title="The model answering here">
              {modelLabel}
            </span>
            <button
              type="button"
              className="knot-icon"
              onClick={hide}
              title="Hide (Esc)"
              aria-label="Hide the overlay"
            >
              <Icon name="close" size={12} />
            </button>
          </header>

          <div className="knot-thread" ref={scroller}>
            {!modelReady && (
              <div className="knot-empty">
                <strong>No companion yet</strong>
                <span>Create one in the world, then this window will use it.</span>
              </div>
            )}
            {modelReady && messages.length === 0 && !streaming && (
              <div className="knot-empty">
                <span className="knot-hello">{GLYPH}</span>
                <strong>I'm here.</strong>
                <span>Press the talk key, tap the mic, or type below. I can see the screen when you ask.</span>
              </div>
            )}

            {messages.slice(-40).map((message) => (
              <div key={message.id} className={`knot-bubble ${message.role}`}>
                {spokenText(message.content).trim()}
              </div>
            ))}

            {streaming && (
              <div className="knot-bubble assistant live">
                {spokenText(streaming)}
                <span className="caret" />
              </div>
            )}

            {activity && (
              <div className="knot-activity">
                <span className="actdot" />
                {activity}
              </div>
            )}

            {recorder.note && <div className="knot-note">{recorder.note}</div>}
            {note && <div className="knot-note">{note}</div>}
            {error && <div className="knot-error">{error}</div>}

            {approvals.map((request) => (
              <div key={request.requestId} className="knot-approval">
                <div className="knot-approval-head">
                  <span className={`cchip ${request.danger}`}>{request.danger}</span>
                  <strong>{request.tool}</strong>
                </div>
                <pre>{request.summary || JSON.stringify(request.args)}</pre>
                <div className="knot-approval-actions">
                  <button type="button" className="primary" onClick={() => void decide(request, "allow")}>
                    Allow
                  </button>
                  <button type="button" onClick={() => void decide(request, "always")}>
                    Always
                  </button>
                  <button type="button" className="danger" onClick={() => void decide(request, "deny")}>
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="knot-compose">
            <button
              type="button"
              className={`knot-mic ${micState}`}
              onClick={() => void talk()}
              title={liveOn ? "End the conversation" : listening ? "Stop and send" : "Talk"}
              aria-label={liveOn ? "End the live conversation" : listening ? "Stop recording and send" : "Start talking"}
            >
              <Icon name={liveOn ? "wave" : listening ? "pause" : "mic"} size={14} />
              {(listening || live.state === "hearing") && (
                <span className="knot-meter" aria-hidden>
                  {[0, 1, 2, 3].map((index) => (
                    <i key={index} style={{ height: `${3 + meter * (index % 2 ? 12 : 8)}px` }} />
                  ))}
                </span>
              )}
            </button>

            <textarea
              ref={composer}
              value={draft}
              rows={1}
              placeholder={
                liveOn
                  ? speakingNow
                    ? "Go ahead — talk over me…"
                    : "Go ahead, I'm listening…"
                  : listening
                    ? "Listening… press again to send"
                    : `Message ${agent?.name ?? "her"}…`
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />

            {running ? (
              <button type="button" className="knot-send stop" onClick={() => void cancelRun()} title="Stop" aria-label="Stop">
                ■
              </button>
            ) : (
              <button
                type="button"
                className="knot-send"
                onClick={submit}
                disabled={!draft.trim()}
                title="Send"
                aria-label="Send"
              >
                ↑
              </button>
            )}
          </div>

          <footer className="knot-foot">
            <span>
              {liveOn ? (
                <>
                  <b>Live</b> — just talk · Space hushes me
                </>
              ) : (
                <>
                  <b>Ctrl+Shift+Space</b> to talk
                </>
              )}
            </span>
            <span>Esc hides</span>
          </footer>
        </section>
      )}
    </div>
  );
}
