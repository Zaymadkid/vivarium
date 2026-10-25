import { useCallback, useEffect, useRef, useState } from "react";
import { floatToWav, isSpeaking, onSpeakingChange } from "./speech";
import { getPrefs } from "./prefs";

/**
 * TALKING BACK AND FORTH.
 *
 * Push-to-talk is a walkie-talkie: press, speak, let go, wait. A conversation is
 * not that. This hook keeps the microphone open while live mode is on, decides
 * for itself when a sentence begins and ends, and hands over the words the
 * moment the person stops talking. Two things make it feel like a person rather
 * than a recorder:
 *
 *   barge-in    if she is speaking and the person starts, her voice stops and
 *               the microphone keeps what they said
 *   no key      after her reply the microphone is already listening again, so
 *               the next thought needs nothing pressed
 *
 * Silence is measured against the room, not a fixed number: a fan, a laptop
 * speaker and a quiet bedroom do not share a threshold.
 */

export type LiveState = "off" | "listening" | "hearing" | "transcribing";

export interface LiveOptions {
  active: boolean;
  /** Words the person finished saying. */
  onUtterance: (text: string) => void;
  /** The person started talking over her: stop the voice now. */
  onBargeIn: () => void;
  onNote?: (note: string | null) => void;
}

/** 2048 frames at 48 kHz is ~43 ms: fast enough to feel instant, slow enough to be cheap. */
const FRAME = 2048;
const SPEECH_FRAMES_START = 4;
const BARGE_FRAMES = 6;
/** Fresh clips echo through the speakers for a moment; never barge in on that. */
const BARGE_GRACE_MS = 550;
/** How much quiet ends a thought. Long enough for a breath, short enough to feel quick. */
const END_SILENCE_MS = 850;
const MIN_SPEECH_MS = 320;
const MAX_UTTERANCE_MS = 25_000;

const cleanError = (err: unknown) =>
  String(err instanceof Error ? err.message : err).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

export function useLiveVoice(options: LiveOptions) {
  const [state, setState] = useState<LiveState>("off");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<LiveState>("off");
  const liveRef = useRef(options);
  liveRef.current = options;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const rafRef = useRef(0);
  const mounted = useRef(true);

  // Capture state for the current thought.
  const chunksRef = useRef<Float32Array[]>([]);
  const preRollRef = useRef<Float32Array[]>([]);
  const hearingRef = useRef(false);
  const voicedRef = useRef(0);
  const silenceRef = useRef(0);
  const startedAtRef = useRef(0);
  const floorRef = useRef(0.004);
  const bargedRef = useRef(false);
  const busyRef = useRef(false);
  const speakingSince = useRef(0);

  useEffect(
    () =>
      onSpeakingChange((on) => {
        if (on) speakingSince.current = Date.now();
      }),
    [],
  );

  const transition = useCallback((next: LiveState) => {
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
    hearingRef.current = false;
    chunksRef.current = [];
    preRollRef.current = [];
    if (mounted.current) setLevel(0);
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      release();
    },
    [release],
  );

  /** One finished thought: transcribe it and hand the words over. */
  const finishUtterance = useCallback(async () => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    preRollRef.current = [];
    hearingRef.current = false;
    voicedRef.current = 0;
    silenceRef.current = 0;
    bargedRef.current = false;

    const rate = ctxRef.current?.sampleRate ?? 48000;
    const frames = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (!frames || frames / rate < 0.3 || frames / rate > 60) {
      if (stateRef.current !== "transcribing") transition("listening");
      return;
    }

    busyRef.current = true;
    transition("transcribing");
    try {
      const bytes = floatToWav(chunks, rate);
      const text = (await window.viv.voice.transcribe(bytes, "audio/wav")).trim();
      if (!text) {
        liveRef.current.onNote?.("I did not catch that.");
      } else {
        liveRef.current.onNote?.(null);
        liveRef.current.onUtterance(text);
      }
    } catch (err) {
      liveRef.current.onNote?.(cleanError(err));
    } finally {
      busyRef.current = false;
      if (mounted.current) transition("listening");
    }
  }, [transition]);

  /** The audio callback: meter, detect speech, and cut utterances on quiet. */
  const analyse = useCallback(
    (frame: Float32Array, sampleRate: number) => {
      let squares = 0;
      for (let i = 0; i < frame.length; i++) squares += frame[i] * frame[i];
      const rms = Math.sqrt(squares / frame.length);
      const speaking = isSpeaking();
      const ms = (frame.length / sampleRate) * 1000;

      // A room's floor drifts. Track it while the room is the only thing talking.
      if (!hearingRef.current) floorRef.current = floorRef.current * 0.97 + rms * 0.03;
      const threshold = Math.max(0.007, floorRef.current * 3.2) * (speaking ? 2.4 : 1);
      const voiced = rms > threshold;

      if (mounted.current) {
        // Every 4th frame is plenty for a meter and far fewer repaints.
        if (Math.random() < 0.06) setLevel(Math.min(1, rms * 9));
      }

      if (!hearingRef.current) {
        preRollRef.current.push(frame);
        if (preRollRef.current.length > 6) preRollRef.current.shift();
        if (busyRef.current) return;
        if (!voiced) return;
        voicedRef.current += 1;
        if (voicedRef.current < SPEECH_FRAMES_START) return;

        // Speech has begun.
        hearingRef.current = true;
        voicedRef.current = 0;
        startedAtRef.current = Date.now();
        silenceRef.current = 0;
        bargedRef.current = false;
        chunksRef.current = [...preRollRef.current];
        preRollRef.current = [];
        transition("hearing");

        // Talking over her is allowed, and it stops her immediately — but not in
        // the first half second of a clip, which is her own onset echoing back.
        if (speaking && Date.now() - speakingSince.current > BARGE_GRACE_MS) {
          bargedRef.current = true;
          liveRef.current.onBargeIn();
        }
        return;
      }

      chunksRef.current.push(frame);
      const elapsed = Date.now() - startedAtRef.current;
      if (voiced) {
        voicedRef.current += ms;
        silenceRef.current = 0;
      } else {
        silenceRef.current += ms;
      }

      // Barge-in after she began talking mid-thought (late detection).
      if (
        !bargedRef.current &&
        isSpeaking() &&
        Date.now() - speakingSince.current > BARGE_GRACE_MS &&
        voiced &&
        voicedRef.current > BARGE_FRAMES * ms &&
        rms > threshold * 1.35
      ) {
        bargedRef.current = true;
        liveRef.current.onBargeIn();
      }

      if (elapsed > MAX_UTTERANCE_MS) {
        void finishUtterance();
        return;
      }
      if (silenceRef.current >= END_SILENCE_MS && voicedRef.current >= MIN_SPEECH_MS) {
        void finishUtterance();
        return;
      }
      // Nothing but a cough: drop it instead of transcribing room noise.
      if (silenceRef.current >= END_SILENCE_MS * 2 && voicedRef.current < MIN_SPEECH_MS) {
        chunksRef.current = [];
        preRollRef.current = [];
        hearingRef.current = false;
        voicedRef.current = 0;
        silenceRef.current = 0;
        bargedRef.current = false;
        transition("listening");
      }
    },
    [finishUtterance, transition],
  );

  useEffect(() => {
    if (!options.active) {
      release();
      transition("off");
      return;
    }
    let cancelled = false;
    setError(null);
    transition("listening");

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This window has no microphone access.");
        transition("off");
        return;
      }
      try {
        const mic = getPrefs().micId;
        const preferred: MediaTrackConstraints = {
          // The reference for the echo canceller is the app's own output, so her
          // voice coming back through the speakers does not end up transcribed
          // as the person's.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(mic && mic !== "default" ? { deviceId: { exact: mic } } : {}),
        };
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: preferred });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setError("This machine has no audio context.");
          transition("off");
          return;
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
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();

        const processor = ctx.createScriptProcessor(FRAME, 1, 1);
        const sink = ctx.createGain();
        sink.gain.value = 0;
        processor.onaudioprocess = (event) => {
          analyse(event.inputBuffer.getChannelData(0), ctx.sampleRate);
        };
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);
        processorRef.current = processor;
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Microphone access was refused."
            : name === "NotFoundError"
              ? "No microphone was found."
              : cleanError(err),
        );
        transition("off");
      }
    };

    void start();
    return () => {
      cancelled = true;
      release();
    };
  }, [options.active, analyse, release, transition]);

  return { state, level, error };
}
