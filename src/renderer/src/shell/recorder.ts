import { useCallback, useEffect, useRef, useState } from "react";
import { floatToWav } from "./speech";
import { getPrefs } from "./prefs";

/**
 * THE MICROPHONE, AS A HOOK.
 *
 * The voice pill and the on-screen companion need the same thing: open the
 * chosen microphone, keep PCM (not Opus) so the offline recogniser can read it,
 * meter it, and hand one clip to the main process. Keeping the state machine
 * here means the overlay does not grow a second, subtly different recorder.
 */
export type RecorderState = "idle" | "connecting" | "listening" | "transcribing";

const cleanError = (err: unknown) =>
  String(err instanceof Error ? err.message : err).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const stateRef = useRef<RecorderState>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const energyRef = useRef({ sum: 0, n: 0 });
  const rafRef = useRef(0);
  const mounted = useRef(true);

  const transition = useCallback((next: RecorderState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try {
      processorRef.current?.disconnect();
    } catch {
      // already detached
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    if (mounted.current) setLevel(0);
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      release();
    },
    [release],
  );

  const begin = useCallback(async (): Promise<boolean> => {
    if (stateRef.current !== "idle") return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNote("This window has no microphone access.");
      return false;
    }
    setNote(null);
    transition("connecting");
    try {
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
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        release();
        setNote("This machine has no audio context.");
        transition("idle");
        return false;
      }
      const ctx = new Ctor();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        if (mounted.current) setLevel(Math.min(1, sum / buf.length / 90));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      pcmRef.current = [];
      energyRef.current = { sum: 0, n: 0 };
      processor.onaudioprocess = (event) => {
        const frame = event.inputBuffer.getChannelData(0);
        pcmRef.current.push(new Float32Array(frame));
        // A silent clip is not worth ten seconds in a recogniser, and a
        // recogniser given only room noise invents words. Track energy so the
        // pill can say it heard nothing instead of guessing.
        let squares = 0;
        for (let i = 0; i < frame.length; i++) squares += frame[i] * frame[i];
        energyRef.current.sum += squares;
        energyRef.current.n += frame.length;
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(ctx.destination);
      processorRef.current = processor;
      transition("listening");
      return true;
    } catch (err) {
      release();
      transition("idle");
      const name = err instanceof Error ? err.name : "";
      setNote(
        name === "NotAllowedError"
          ? "Microphone access was refused."
          : name === "NotFoundError"
            ? "No microphone was found."
            : cleanError(err),
      );
      return false;
    }
  }, [release, transition]);

  const finish = useCallback(async (): Promise<string | null> => {
    if (stateRef.current !== "listening") return null;
    const rate = ctxRef.current?.sampleRate ?? 48000;
    const chunks = pcmRef.current;
    const frames = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (!chunks.length || frames / rate < 0.35) {
      release();
      transition("idle");
      setNote("No clip was recorded. Hold for a moment longer.");
      return null;
    }
    const energy = energyRef.current;
    const rms = energy.n > 0 ? Math.sqrt(energy.sum / energy.n) : 0;
    if (rms < 0.01) {
      release();
      transition("idle");
      setNote("I did not hear anything. Check the microphone in Settings → Voice.");
      return null;
    }
    const bytes = floatToWav(chunks, rate);
    release();
    if (bytes.length < 2400) {
      transition("idle");
      setNote("That was too short — hold for a moment longer.");
      return null;
    }
    transition("transcribing");
    try {
      const text = await window.viv.voice.transcribe(bytes, "audio/wav");
      if (!text.trim()) {
        setNote("I did not catch any words.");
        return null;
      }
      setNote(null);
      return text.trim();
    } catch (err) {
      setNote(cleanError(err));
      return null;
    } finally {
      transition("idle");
    }
  }, [release, transition]);

  const cancel = useCallback(() => {
    release();
    setNote(null);
    transition("idle");
  }, [release, transition]);

  return { state, level, note, begin, finish, cancel };
}
