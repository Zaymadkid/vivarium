import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { floatToWav } from "./speech";
import { getPrefs } from "./prefs";

type VoiceState = "connecting" | "listening" | "transcribing" | "heard" | "error" | "unavailable" | "denied";

const LABEL: Record<VoiceState, string> = {
  connecting: "Connecting",
  listening: "Listening",
  transcribing: "Writing it down",
  heard: "Heard you",
  error: "Could not transcribe",
  unavailable: "Voice unavailable",
  denied: "Not listening",
};

/**
 * Push to talk. The microphone meters while it listens, records the clip, and
 * sends it to ElevenLabs `scribe_v1` when it closes; the words land in the chat
 * composer, never sent on their own. The key stays in the main process.
 */
export function VoicePill({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<VoiceState>("connecting");
  // A retry has to restart the capture effect, not just repaint the label.
  const [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const energyRef = useRef({ sum: 0, n: 0 });
  const rafRef = useRef(0);
  const stateRef = useRef<VoiceState>("connecting");
  stateRef.current = state;

  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try {
      processorRef.current?.disconnect();
    } catch {
      // already detached
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("connecting");
    setTranscript("");
    setNote(null);

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setState("unavailable");
        return;
      }
      try {
        // Settings → Companion → Voice → Microphone. A chosen device is exact; a
        // device that was unplugged falls back to the system default instead of
        // leaving push-to-talk broken.
        const mic = getPrefs().micId;
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: mic && mic !== "default" ? { deviceId: { exact: mic } } : true,
          });
        } catch (err) {
          if (!mic || mic === "default") throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setState("unavailable");
          return;
        }
        const ctx = new Ctor();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        setState("listening");
        const tick = () => {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          setLevel(Math.min(1, sum / buf.length / 90));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();

        // PCM, not Opus: the free offline recogniser needs a WAV it can open,
        // and the hosted one is exactly what runs out of credits. A muted gain
        // keeps the processor pulled without echoing the microphone.
        try {
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          const sink = ctx.createGain();
          sink.gain.value = 0;
          pcmRef.current = [];
          energyRef.current = { sum: 0, n: 0 };
          processor.onaudioprocess = (event) => {
            const frame = event.inputBuffer.getChannelData(0);
            pcmRef.current.push(new Float32Array(frame));
            let squares = 0;
            for (let i = 0; i < frame.length; i++) squares += frame[i] * frame[i];
            energyRef.current.sum += squares;
            energyRef.current.n += frame.length;
          };
          src.connect(processor);
          processor.connect(sink);
          sink.connect(ctx.destination);
          processorRef.current = processor;
        } catch {
          setNote("This machine would not open a recorder.");
        }
      } catch {
        if (!cancelled) setState("denied");
      }
    };

    void start();
    return () => {
      cancelled = true;
      release();
    };
  }, [open, release, attempt]);

  const finish = useCallback(async () => {
    const rate = ctxRef.current?.sampleRate ?? 48000;
    const chunks = pcmRef.current;
    const frames = chunks.reduce((n, c) => n + c.length, 0);
    if (!chunks.length || frames / rate < 0.35) {
      release();
      setNote("No clip was recorded. Check the microphone.");
      setState("error");
      return;
    }
    const energy = energyRef.current;
    const rms = energy.n > 0 ? Math.sqrt(energy.sum / energy.n) : 0;
    if (rms < 0.01) {
      release();
      setNote("I did not hear anything. Check the microphone in Settings → Voice, then hold Space again.");
      setState("error");
      return;
    }
    setState("transcribing");
    const bytes = floatToWav(chunks, rate);
    release();
    if (bytes.length < 2400) {
      setNote("That was too short — hold for a moment longer.");
      setState("error");
      return;
    }
    try {
      const text = await window.viv.voice.transcribe(bytes, "audio/wav");
      if (!text) {
        setNote("I did not catch any words.");
        setState("error");
        return;
      }
      setTranscript(text);
      setState("heard");
      // Push-to-talk sends the turn. The transcript used to sit in a card until
      // a second key press and a click, which read as "it did not hear me".
      window.dispatchEvent(new CustomEvent("viv:voice-text", { detail: { text, send: true } }));
      onClose();
    } catch (err) {
      setNote(
        String(err instanceof Error ? err.message : err).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
      setState("error");
    }
  }, [release]);

  const useIt = () => {
    if (!transcript) return;
    window.dispatchEvent(new CustomEvent("viv:voice-text", { detail: { text: transcript, send: true } }));
    onClose();
  };

  // Space is owned by the window so the first press can open the recorder before
  // this component exists. Releasing a held key, or tapping Stop, ends the clip.
  useEffect(() => {
    if (!open) return;
    const onFinish = () => {
      if (stateRef.current === "listening") {
        void finish();
        return;
      }
      if (stateRef.current === "heard") {
        onClose();
        return;
      }
      // A short hold can end before the microphone has opened. Wait for it
      // briefly, then finish, instead of dropping the key press on the floor.
      if (stateRef.current === "connecting") {
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (stateRef.current === "listening") {
            window.clearInterval(timer);
            void finish();
          } else if (stateRef.current !== "connecting" || Date.now() - started > 2500) {
            window.clearInterval(timer);
          }
        }, 100);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("viv:voice-finish", onFinish);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("viv:voice-finish", onFinish);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, finish]);

  if (!open) return null;

  const retry = () => {
    setState("connecting");
    setLevel(0);
    setNote(null);
    setAttempt((current) => current + 1);
  };

  return (
    <div className="voice-pill-wrap">
      <div className={`voice-pill ${state}`}>
        {state === "listening" && <span className="voice-ring" />}
        <span className="voice-dot" />
        <span className="voice-label">{LABEL[state]}</span>
        <span className="voice-meter" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <i
              key={i}
              style={{
                height: `${4 + (state === "listening" ? level * (i % 2 ? 11 : 15) : 2)}px`,
                animationDelay: `${i * 90}ms`,
              }}
            />
          ))}
        </span>
        {state === "listening" && (
          <button className="voice-act primary" onClick={() => void finish()}>
            Stop
          </button>
        )}
        <button
          className="icon-btn sm"
          aria-label="Close voice"
          onClick={state === "unavailable" || state === "denied" ? retry : onClose}
        >
          <Icon name={state === "unavailable" || state === "denied" ? "refresh" : "close"} size={12} />
        </button>
      </div>

      {(state === "heard" || state === "error") && (
        <div className="voice-heard">
          <p>{state === "heard" ? transcript : note}</p>
          <div className="voice-heard-actions">
            {state === "heard" ? (
              <>
                <button className="voice-act primary" onClick={useIt}>
                  Use it
                </button>
                <button className="voice-act" onClick={onClose}>
                  Discard
                </button>
              </>
            ) : (
              <>
                <button className="voice-act primary" onClick={retry}>
                  Try again
                </button>
                <button className="voice-act" onClick={onClose}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <span className="voice-hint">
        {state === "unavailable"
          ? "Voice unavailable — click to retry"
          : state === "denied"
            ? "Not listening. Your microphone is off."
            : state === "listening"
              ? "Listening — let go of Space when you are done."
              : state === "transcribing"
                ? "Writing it down…"
                : state === "heard"
                  ? "Sending it to her…"
                  : state === "error"
                    ? "Nothing was added to the chat."
                    : "Spacebar for voice"}
      </span>
    </div>
  );
}
