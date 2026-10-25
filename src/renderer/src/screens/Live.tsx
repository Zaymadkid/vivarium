import { useCallback, useEffect, useRef, useState } from "react";
import { floatToWav } from "../shell/speech";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { Chip, Empty } from "../shell/ui";

/**
 * LIVE CALL ASSIST.
 *
 * It listens to what the machine is playing, not to the microphone: the other
 * person's voice is a loopback of the system output, so no room noise and no
 * second person's mic are involved. Every ~12 seconds the clip goes through the
 * same offline-first recogniser the talk key uses, and the rolling transcript is
 * what she is asked about.
 *
 * Nothing is uploaded unless a hosted transcriber is configured, and nothing is
 * written to disk: the transcript is a list in this component and disappears
 * when you stop listening or leave the screen.
 */

interface Line {
  at: number;
  text: string;
}

const CHUNK_MS = 12_000;

function clean(err: unknown) {
  return String(err instanceof Error ? err.message : err).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}

export function LiveScreen({ agentId }: { agentId: string }) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [assist, setAssist] = useState<{ question: string; answer: string; pending: boolean } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const levelRef = useRef(0);
  const chunkTimer = useRef<number | null>(null);
  const rafRef = useRef(0);
  const runRef = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      teardown();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Whatever she answers for this screen is streamed here; the same turn also
  // lands in the chat thread, so there is one history, not two.
  useEffect(
    () =>
      window.viv.chat.onEvent((event) => {
        if (!runRef.current) return;
        if (!("runId" in event) || event.runId !== runRef.current) return;
        if (event.type === "delta") {
          const text = event.text;
          setAssist((current) => (current ? { ...current, answer: current.answer + text } : current));
        }
        if (event.type === "done") {
          setAssist((current) => (current ? { ...current, pending: false } : current));
          runRef.current = null;
        }
        if (event.type === "error") {
          setAssist((current) => (current ? { ...current, answer: current.answer || event.message, pending: false } : current));
          runRef.current = null;
        }
      }),
    [],
  );

  const teardown = () => {
    if (chunkTimer.current) window.clearInterval(chunkTimer.current);
    chunkTimer.current = null;
    cancelAnimationFrame(rafRef.current);
    try {
      processorRef.current?.disconnect();
    } catch {
      // already gone
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    pcmRef.current = [];
    levelRef.current = 0;
    setLevel(0);
  };

  const flush = useCallback(async (force = false) => {
    const chunks = pcmRef.current;
    const rate = ctxRef.current?.sampleRate ?? 48000;
    const frames = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (!chunks.length) return;
    pcmRef.current = [];
    if (frames / rate < (force ? 1.2 : 3)) return;
    // A silent stretch is not a sentence; skipping it keeps whisper fast.
    if (!force && levelRef.current < 0.02) return;
    const bytes = floatToWav(chunks, rate);
    try {
      const text = await window.viv.voice.transcribe(bytes, "audio/wav");
      const clean_ = text.trim();
      if (clean_ && alive.current) {
        setLines((current) => [...current.slice(-40), { at: Date.now(), text: clean_ }]);
      }
    } catch (err) {
      if (alive.current) setNote(clean(err));
    }
  }, []);

  const start = async () => {
    setNote(null);
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("This window cannot capture system audio.");
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audio = stream.getAudioTracks();
      if (audio.length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          "No system audio came through. Windows only shares it with a loopback source; try again and allow audio.",
        );
      }
      // The picture is only the price of admission for the audio track.
      stream.getVideoTracks().forEach((track) => track.stop());
      streamRef.current = new MediaStream(audio);

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("This machine has no audio context.");
      const ctx = new Ctor();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const next = Math.min(1, sum / buf.length / 70);
        levelRef.current = next;
        if (alive.current) {
          // Throttle the meter: six updates a second is smooth and cheap.
          setLevel((current) => (Math.abs(current - next) > 0.03 ? next : current));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      pcmRef.current = [];
      processor.onaudioprocess = (event) => {
        pcmRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        // A runaway buffer if transcription stalls would eat memory: keep ~40s.
        const frames = pcmRef.current.reduce((n, c) => n + c.length, 0);
        if (frames / (ctx.sampleRate || 48000) > 40) pcmRef.current.shift();
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(ctx.destination);
      processorRef.current = processor;

      chunkTimer.current = window.setInterval(() => void flush(), CHUNK_MS);
      setListening(true);
      setNote("Listening to what this PC is playing. Headphones keep the call from echoing into the mic.");
    } catch (err) {
      teardown();
      setNote(clean(err));
      setListening(false);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setListening(false);
    await flush(true);
    teardown();
  };

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    const transcript = lines
      .slice(-14)
      .map((line) => line.text)
      .join(" ")
      .slice(-3500);
    if (!agentId) {
      setAssist({ question: prompt, answer: "No companion is selected.", pending: false });
      return;
    }
    setBusy(true);
    setAssist({ question: prompt, answer: "", pending: true });
    try {
      const { runId } = await window.viv.chat.send(
        agentId,
        "The person is on a live call and cannot type a long question. Here is what has been said so far (from the other side of the call):\n\n" +
          (transcript || "(nothing transcribed yet)") +
          "\n\nThey ask: " +
          prompt +
          "\n\nAnswer in at most four short sentences, ready to say out loud. Give the next sentence to say first, then any fact they need. If the transcript is not enough, say what to listen for rather than guessing.",
      );
      runRef.current = runId;
      setQuestion("");
    } catch (err) {
      setAssist({ question: prompt, answer: clean(err), pending: false });
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setLines([]);
    setAssist(null);
    setNote(null);
  };

  return (
    <section className="screen" aria-label="Live call">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Live call</h1>
          <p className="screen-sub">
            {listening ? `Listening · ${lines.length} passages` : "System audio → local transcript → an answer you can say"}
          </p>
        </div>
        <div className="screen-actions">
          <button className="icon-btn" onClick={clear} aria-label="Clear transcript" title="Clear transcript">
            <Icon name="trash" size={14} />
          </button>
          {listening ? (
            <button className="btn sm" onClick={() => void stop()}>
              <Icon name="pause" size={12} />
              Stop listening
            </button>
          ) : (
            <button className="btn sm primary" onClick={() => void start()} disabled={busy}>
              <Icon name="mic" size={12} />
              Start listening
            </button>
          )}
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Hears the call through a system-audio loopback and keeps a transcript on this machine."
          connects="The offline recogniser first, then Windows Speech, then ElevenLabs if a key is set; her answers stream from the normal chat turn."
          needs="Windows loopback audio. Headphones are better: speakers leak the call into your microphone."
          note="The transcript is not saved. Leaving this screen or pressing Stop throws it away, and the clip is deleted after each transcription."
        />

        {note && <p className="live-note">{note}</p>}

        <div className={`live-meter ${listening ? "on" : ""}`} aria-hidden>
          <span style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
        </div>

        <div className="live-grid">
          <div className="live-panel">
            <header className="live-panel-head">
              <span>
                <Dot on={listening} />
                Transcript
              </span>
              <Chip tone={listening ? "live" : "idle"}>{listening ? "capturing" : "idle"}</Chip>
            </header>
            <div className="live-transcript" aria-live="polite">
              {lines.length === 0 ? (
                <p className="muted">
                  {listening
                    ? "Listening. The first passage lands after about twelve seconds of speech."
                    : "Press Start listening while a call is playing. Nothing is recorded from your microphone."}
                </p>
              ) : (
                lines.map((line, i) => (
                  <p key={`${line.at}-${i}`}>
                    <time>{new Date(line.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    {line.text}
                  </p>
                ))
              )}
            </div>
          </div>

          <div className="live-panel">
            <header className="live-panel-head">
              <span>
                <Icon name="spark" size={12} />
                Coach
              </span>
            </header>
            <div className="live-coach">
              {(["What should I say?", "Summarise what they want", "What did they just commit to?"] as const).map((prompt) => (
                <button key={prompt} className="chipbtn" onClick={() => void ask(prompt)} disabled={busy || lines.length === 0}>
                  {prompt}
                </button>
              ))}
              <div className="live-ask">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about the call…"
                  aria-label="Ask about the call"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                />
                <button className="btn sm primary" onClick={() => void ask(question)} disabled={busy || !question.trim()}>
                  Ask
                </button>
              </div>
              {assist ? (
                <article className="live-answer">
                  <header>
                    <Chip tone="warm">{assist.question}</Chip>
                    {assist.pending && <span className="live-thinking">thinking…</span>}
                  </header>
                  <p>{assist.answer || (assist.pending ? "…" : "No answer.")}</p>
                </article>
              ) : (
                <Empty
                  tight
                  icon="wave"
                  title="No coaching yet"
                  body="Once a few passages are in, ask for the next sentence, a summary or what they promised."
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Dot({ on }: { on: boolean }) {
  return <i className={`live-dot ${on ? "on" : ""}`} aria-hidden />;
}
