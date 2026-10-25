import type { EdgeTTS } from "@andresaya/edge-tts";

/**
 * A HUMAN-SOUNDING FREE VOICE.
 *
 * Windows' SAPI voices are clear but mechanical. Microsoft's Edge read-aloud
 * voices are neural, free, and need no key: the same service the browser uses
 * when you press “Read aloud”. This asks it for one short clip and hands the
 * renderer a data URL.
 *
 * The endpoint occasionally refuses a handshake or a DNS answer points at an
 * unreachable IPv6 address. Those are moments, not an outage, so a failure is
 * retried on a fresh socket and remembered for twenty seconds — not forty — and
 * a clip that was already synthesised is reused instead of paid for twice.
 */

export type VoiceStyle = "default" | "warm" | "crisp" | "deep";

const VOICES: Record<VoiceStyle, { voice: string; rate: string; pitch: string }> = {
  // Ava's multilingual model is the one people mistake for a recording: soft
  // edges, real phrasing. A hair under normal speed is how a person talks when
  // they are thinking, not how a narrator reads.
  default: { voice: "en-US-AvaMultilingualNeural", rate: "-4%", pitch: "-1Hz" },
  warm: { voice: "en-US-AvaMultilingualNeural", rate: "-8%", pitch: "-2Hz" },
  crisp: { voice: "en-US-EmmaMultilingualNeural", rate: "+0%", pitch: "+0Hz" },
  deep: { voice: "en-US-AndrewMultilingualNeural", rate: "-6%", pitch: "-4Hz" },
};

let engine: EdgeTTS | null = null;
let failedAt = 0;
// Long enough to stop hammering a dead network, short enough that one dropped
// handshake does not leave her sounding like a machine for a whole conversation.
const FAIL_FOR_MS = 20_000;
const CLIPS = 12;
const cache = new Map<string, string>();

function styleOf(value: unknown): VoiceStyle {
  return value === "warm" || value === "crisp" || value === "deep" ? value : "default";
}

async function instance(): Promise<EdgeTTS> {
  if (engine) return engine;
  const mod = await import("@andresaya/edge-tts");
  engine = new mod.EdgeTTS({ timeout: 15_000 });
  return engine;
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as Error & { code?: string }).code;
  return [err.name || "Error", code, err.message || "(no message)"].filter(Boolean).join(" ");
}

/**
 * Opening the voice list warms DNS, TLS and the engine before the first answer.
 * It costs one request at launch and saves the first reply from a cold timeout.
 */
export async function warmNeuralVoice(): Promise<boolean> {
  try {
    const tts = await instance();
    await tts.getVoices();
    failedAt = 0;
    return true;
  } catch (err) {
    console.info(`[voice] neural endpoint not answering yet (${describe(err).slice(0, 160)})`);
    return false;
  }
}

/** Returns a playable data URL, or null when the service cannot be reached. */
export async function neuralSpeech(text: string, style?: unknown): Promise<string | null> {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  if (!clean) return null;

  const key = `${styleOf(style)}:${clean}`;
  const hit = cache.get(key);
  if (hit) {
    // Touch the key so the least recently spoken clip is the one evicted.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  if (Date.now() - failedAt < FAIL_FOR_MS) return null;

  const preset = VOICES[styleOf(style)];
  // A couple of percent either way stops repeated lines sounding stamped from
  // the same mould. Stable per phrase in the cache, so a replay is identical.
  const rate = Number(preset.rate.replace("%", ""));
  const wobble = (key.length % 5) - 2;
  const attempt = async (): Promise<string> => {
    const tts = await instance();
    const result = await tts.generate(clean, preset.voice, {
      rate: `${rate + wobble}%`,
      pitch: preset.pitch,
      volume: "+0%",
    });
    if (!result.audio || result.audio.length < 800) throw new Error("the clip came back empty");
    const audio = Buffer.from(result.audio);
    return `data:audio/mp3;base64,${audio.toString("base64")}`;
  };

  const tries = async (): Promise<string> => {
    try {
      return await attempt();
    } catch (first) {
      // A fresh socket: the first call after a cold start is the one that most
      // often loses the handshake.
      engine = null;
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        return await attempt();
      } catch (second) {
        throw new Error(`${describe(first)} / ${describe(second)}`);
      }
    }
  };

  try {
    const url = await tries();
    failedAt = 0;
    cache.set(key, url);
    while (cache.size > CLIPS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return url;
  } catch (err) {
    failedAt = Date.now();
    console.info(
      `[voice] neural voice unavailable for ${FAIL_FOR_MS / 1000}s; using the OS voice (${describe(err).slice(0, 240)})`,
    );
    return null;
  }
}
