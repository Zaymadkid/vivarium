/**
 * SPEAKING, WITH A FLOOR UNDER IT.
 *
 * ElevenLabs is the voice she is meant to have, but it runs on credits, and a
 * key with none of them should not leave the app mute. `speakText` tries the
 * hosted voice first and falls back to the OS voice that ships with Windows —
 * free, offline, no key. Once ElevenLabs answers with a quota/refused error the
 * fallback is remembered, so the next Play goes straight to the free voice
 * instead of paying a failed round trip every time.
 */

import { getPrefs, type Prefs } from "./prefs";

let blocked = false;
let neuralDownUntil = 0;
let cachedVoice: string | null | undefined;
let cachedFor: Prefs["voice"] | null = null;
let activeAudio: HTMLAudioElement | null = null;
let releaseAudio: (() => void) | null = null;

/**
 * IS SHE TALKING RIGHT NOW.
 *
 * A conversation needs this: the microphone must not mistake her own voice for
 * the person's, and the person must be able to talk over her. One flag, one set
 * of listeners, updated by every engine.
 */
let speaking = false;
const speakingHooks = new Set<(on: boolean) => void>();

function setSpeaking(on: boolean) {
  if (speaking === on) return;
  speaking = on;
  for (const hook of speakingHooks) {
    try {
      hook(on);
    } catch {
      // a listener that threw is not worth a broken voice
    }
  }
}

export function isSpeaking(): boolean {
  return speaking;
}

/** Called with true when a clip starts and false when the voice falls silent. */
export function onSpeakingChange(cb: (on: boolean) => void): () => void {
  speakingHooks.add(cb);
  return () => void speakingHooks.delete(cb);
}

const PREFERRED = ["zira", "aria", "jenny", "hazel", "sonia", "samantha", "female"];

/**
 * Settings → Preferences → Voice. The hosted voice has its own picker; this is
 * how the free offline voice is made warm, crisp or deep instead of always the
 * same Windows default.
 */
const VOICE_STYLE: Record<Prefs["voice"], { rate: number; pitch: number; prefer: string[] }> = {
  // Slightly under conversational speed reads as thoughtful rather than slow;
  // the punctuation is already in the text, so the voice does the phrasing.
  default: { rate: 0.98, pitch: 1, prefer: PREFERRED },
  warm: { rate: 0.94, pitch: 0.94, prefer: ["sonia", "hazel", "aria", "female", ...PREFERRED] },
  crisp: { rate: 1.04, pitch: 1.04, prefer: ["aria", "zira", "jenny", ...PREFERRED] },
  deep: { rate: 0.9, pitch: 0.82, prefer: ["george", "david", "guy", "ryan", "mark", ...PREFERRED] },
};

export function pickSystemVoice(voices: string[], prefer: string[] = PREFERRED): string | null {
  const lowered = voices.map((name) => ({ name, lower: name.toLowerCase() }));
  for (const wanted of prefer) {
    const hit = lowered.find((v) => v.lower.includes(wanted));
    if (hit) return hit.name;
  }
  return voices.find((name) => /english|en[-_]/i.test(name)) ?? voices[0] ?? null;
}

export async function systemVoiceName(): Promise<string | null> {
  const style = getPrefs().voice;
  if (cachedVoice !== undefined && cachedFor === style) return cachedVoice;
  cachedFor = style;
  try {
    cachedVoice = pickSystemVoice(await window.viv.voice.systemVoices(), VOICE_STYLE[style]?.prefer);
  } catch {
    cachedVoice = null;
  }
  return cachedVoice;
}

/**
 * RECORDING, AS A FILE THE OFFLINE RECOGNISER CAN READ.
 *
 * A MediaRecorder gives Opus in a WebM envelope, which System.Speech cannot
 * open — and the hosted transcriber is the part that runs out of credits. The
 * microphone is therefore captured as PCM and written here as 16-bit mono WAV
 * at 16 kHz, the shape both engines accept.
 */
export function floatToWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const source = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    source.set(chunk, at);
    at += chunk.length;
  }
  // 16 kHz is plenty for speech and keeps the upload small.
  const target = 16000;
  const ratio = sampleRate / target;
  const frames = Math.max(1, Math.floor(source.length / ratio));
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(source.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += source[j];
    const value = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : 0));
    samples[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }

  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, target, true);
  view.setUint32(28, target * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(bytes.buffer, 44).set(samples);
  return bytes;
}

/** Strip the markdown a chat bubble carries so it is not read as punctuation. */
function spoken(text: string) {
  return text
    // Code, inline mentions and links are for the eye, not the ear.
    .replace(/```[\s\S]*?```/g, " ")
    // A fence that is still open mid-stream is code too. Reading JSON aloud is
    // the fastest way to sound like a machine.
    .replace(/```[\s\S]*$/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    // Paths and filenames turn an answer into a recital. The user can see them.
    .replace(/\b[A-Za-z]:\\[^\s,;)\]"']+/g, " ")
    .replace(/(?:^|\s)\/[\w.-]+(?:\/[\w.-]+)+/g, " ")
    .replace(/\b[\w-]+\.(?:md|txt|json|jsonl|ts|tsx|js|jsx|mjs|py|rb|go|rs|png|jpe?g|gif|pdf|csv|html?|css|log|ya?ml|toml|lock)\b/gi, " ")
    // Tables, rules and list markers are structure, not speech.
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, " ")
    .replace(/[*_#>~]/g, "")
    // Speaker labels and stage directions read like a script, not a person.
    .replace(/^\s*(?:you|assistant|ai|companion)\s*:\s*/gim, "")
    .replace(/\(\s*(?:laughs?|smiles?|pause[sd]?|sighs?)[^)]*\)/gi, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim()
    .slice(0, 3000);
}

/** The full text as it should be read, with the eye-only parts removed. */
export function spokenForVoice(text: string): string {
  return spoken(text);
}

/** Split prose into sentences without breaking on decimals or abbreviations. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 1);
}

const keyOf = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * WHAT SHE ACTUALLY SAYS OUT LOUD.
 *
 * A good answer is longer than a good sentence. Reading the whole thing turns
 * her into a narrator, so automatic speech takes the opening thought only: the
 * first two sentences that carry meaning, skipping greetings, headings and
 * anything already said. Manual “play” on a bubble still reads the whole text.
 *
 * `completeOnly` is for streaming: it will not end a clip mid-sentence.
 */
export function briefForSpeech(text: string, maxWords = 52, completeOnly = false): string {
  const clean = spoken(text);
  if (!clean) return "";
  const rows = sentences(clean);
  const pool = completeOnly && rows.length > 0 && !/[.!?]$/.test(rows[rows.length - 1])
    ? rows.slice(0, -1)
    : rows;
  const picked: string[] = [];
  const seen = new Set<string>();
  let words = 0;
  for (const raw of pool) {
    // An opener can share a sentence with the point (“Here's what I found: the
    // key is missing”). Strip the opener, keep the point; only drop the line when
    // nothing is left but throat-clearing.
    let line = raw
      .replace(/^(?:sure|certainly|of course|absolutely|great question|happy to help)[,.!]?\s*/i, "")
      .replace(/^here(?:'s| is) (?:what|how|the|a)[^:.!?]*[:.]\s*/i, "")
      .trim();
    if (picked.length === 0 && /^i(?:'ll| will) (?:take a look|check|help)\b/i.test(line)) line = "";
    const key = keyOf(line);
    if (!key || seen.has(key)) continue;
    const count = line.split(/\s+/).filter(Boolean).length;
    if (picked.length > 0 && words + count > maxWords) break;
    picked.push(line);
    seen.add(key);
    words += count;
    if (words >= maxWords || picked.length >= 2) break;
  }
  // If every line was throat-clearing, say nothing. Silence is more human than
  // reading “Sure!” down the phone.
  return picked.join(" ").trim().slice(0, 360);
}

/**
 * The free voice, played by Chromium itself where it can. SAPI through
 * PowerShell only works if the app's audio route is audible; the renderer
 * speaks on the app's own output, which is the route the person is already
 * listening to.
 */
function browserSpeak(text: string, voice: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") {
      reject(new Error("no speech synthesis"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      setSpeaking(false);
      if (error) reject(error);
      else resolve();
    };
    const wanted = (voice ?? "").toLowerCase();
    const match = speechSynthesis.getVoices().find((v) => v.name.toLowerCase() === wanted)
      ?? speechSynthesis.getVoices().find((v) => v.name.toLowerCase().includes(wanted) && wanted.length > 0)
      ?? speechSynthesis.getVoices().find((v) => v.name.toLowerCase().includes("zira"))
      ?? speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
    if (match) utterance.voice = match;
    const style = VOICE_STYLE[getPrefs().voice] ?? VOICE_STYLE.default;
    utterance.rate = style.rate;
    utterance.pitch = style.pitch;
    utterance.onend = () => finish();
    utterance.onerror = (event) => finish(new Error(event.error || "speech failed"));
    // The previous line is already finished before this one is called, so a
    // cancel here only ever cut her off mid-word. Drop anything stale instead.
    if (speechSynthesis.speaking && !speechSynthesis.pending) speechSynthesis.cancel();
    setSpeaking(true);
    speechSynthesis.speak(utterance);
    // Some Windows builds never fire `end`. Budget from the words spoken, not
    // from a guess that could resolve while she is still talking.
    const words = text.split(/\s+/).filter(Boolean).length;
    window.setTimeout(() => finish(), 3000 + words * 520);
  });
}

export function voiceEngineBlocked() {
  return blocked;
}

export function resetVoiceEngine() {
  blocked = false;
  neuralDownUntil = 0;
  cachedVoice = undefined;
  cachedFor = null;
}

/** Stop whatever is speaking right now. Safe when nothing is. */
export function stopSpeech() {
  setSpeaking(false);
  try {
    speechSynthesis.cancel();
  } catch {
    /* no synthesizer in this window */
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      /* already gone */
    }
    activeAudio = null;
  }
  releaseAudio?.();
  releaseAudio = null;
}

async function playAudio(url: string): Promise<void> {
  const element = new Audio(url);
  activeAudio = element;
  setSpeaking(true);
  await new Promise<void>((resolve, reject) => {
    releaseAudio = resolve;
    element.onended = () => resolve();
    element.onerror = () => reject(new Error("The voice clip could not play."));
    void element.play().catch(reject);
  }).catch((err) => {
    setSpeaking(false);
    throw err;
  });
  if (activeAudio === element) {
    activeAudio = null;
    setSpeaking(false);
  }
  releaseAudio = null;
}

/**
 * Play a line. Returns which engine actually spoke, so the caller can say so
 * instead of pretending the premium voice worked.
 *
 * Order: the person's ElevenLabs voice (best, paid), then Microsoft's neural
 * read-aloud voice (free, sounds like a person, needs a network), then the
 * Windows SAPI voice (free, offline, unmistakably a machine).
 */
export type VoiceEngine = "elevenlabs" | "neural" | "system";

/** A line with its audio already fetched, waiting to be played. */
export interface PreparedSpeech {
  engine: VoiceEngine;
  say: () => Promise<void>;
}

/**
 * FETCH NOW, PLAY IN ORDER.
 *
 * Synthesis takes a second or two. A conversation that waits for the audio of
 * each sentence before fetching the next one spends that time in silence, which
 * is what “it stops talking” actually sounded like. Preparing the next line
 * while the current one plays keeps her continuous; playing stays serial so two
 * voices never overlap.
 */
export async function prepareSpeech(text: string): Promise<PreparedSpeech> {
  const clean = spoken(text);
  if (!clean) return { engine: "system", say: async () => undefined };

  if (!blocked) {
    try {
      const { audio } = await window.viv.voice.speak(clean);
      return { engine: "elevenlabs", say: () => playAudio(audio) };
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      // No key, no credits, a refused key: all mean "stop trying this engine",
      // not "try it again on the next sentence".
      if (/credit|quota|401|refus|no elevenlabs key|add one in settings/i.test(message)) blocked = true;
    }
  }

  if (Date.now() > neuralDownUntil) {
    try {
      const url = await window.viv.voice.neural(clean, getPrefs().voice);
      if (url) return { engine: "neural", say: () => playAudio(url) };
      // A null answer is "cannot reach it right now"; pause briefly instead of
      // paying a timeout on every sentence, then let the good voice try again.
      neuralDownUntil = Date.now() + 20_000;
    } catch {
      neuralDownUntil = Date.now() + 20_000;
    }
  }

  const voice = await systemVoiceName();
  return {
    engine: "system",
    say: async () => {
      try {
        await browserSpeak(clean, voice);
      } catch {
        await window.viv.voice.systemSpeak(clean, voice ?? undefined);
      }
    },
  };
}

export async function playPrepared(prepared: PreparedSpeech): Promise<void> {
  await prepared.say();
}

/** Play a line. Returns which engine actually spoke. */
export async function speakText(text: string): Promise<VoiceEngine> {
  const prepared = await prepareSpeech(text);
  await prepared.say();
  return prepared.engine;
}

/** The neural voice on its own, for a Settings sample. */
export async function speakWithNeural(text: string): Promise<boolean> {
  const url = await window.viv.voice.neural(spoken(text), getPrefs().voice).catch(() => null);
  if (!url) return false;
  await playAudio(url);
  return true;
}

/** The free voice on its own, for the Settings sample button. */
export async function speakWithSystem(text: string) {
  const voice = await systemVoiceName();
  try {
    await browserSpeak(spoken(text), voice);
  } catch {
    await window.viv.voice.systemSpeak(spoken(text), voice ?? undefined);
  }
}
