import {
  prepareSpeech,
  playPrepared,
  sentences,
  speakText,
  spokenForVoice,
  stopSpeech,
  type PreparedSpeech,
} from "./speech";

/**
 * ONE TURN, ONE VOICE.
 *
 * The old streaming reader spoke the opening sentence of a reply and then went
 * quiet, which is what “it stops talking in the middle” sounded like. A
 * conversation needs the opposite: keep talking while the answer is still being
 * written, and never overlap two voices.
 *
 * Two readings, one queue:
 *
 *   brief   the opening thought only — a notification, not a narration
 *   full    every sentence, as soon as it is finished, so speech and streaming
 *           happen at the same time instead of one after the other
 *
 * The next chunk is fetched while the current one is playing (see
 * `prepareSpeech`), so the only silence in a turn is the thinking at its start.
 */

export interface VoiceTurn {
  /** Feed streamed text. Speaks as soon as there is a whole sentence. */
  delta(runId: string, text: string): void;
  /** The turn finished: flush the last partial sentence. */
  done(runId: string, text: string): void;
  /** Throw the turn away: silence now, and ignore anything queued. */
  reset(): void;
  /** Stop speaking for a moment, because the person is talking. */
  silence(): void;
  /**
   * The mind replaced its own text mid-turn (a CLI moved to its next hop). Let
   * the clip that is playing finish, drop what was queued, and read the new
   * text from its start — cutting a sentence in half is exactly the glitch a
   * person notices.
   */
  restart(runId: string): void;
}

const keyOf = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MAX_SPOKEN = 2600;

/**
 * Index just past the first finished sentence, or -1 while it is still being
 * written. “Dr.” and “3.5” are not the end of a thought.
 */
function firstSentenceEnd(raw: string): number {
  const ends = /[.!?…]["'”’)\]]?(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = ends.exec(raw))) {
    const at = match.index;
    const prev = raw[at - 1] ?? "";
    const next = raw[at + 1] ?? "";
    if (/[0-9]/.test(prev) && /[0-9]/.test(next)) continue;
    const before = raw.slice(Math.max(0, at - 12), at + 1);
    if (/\b(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e)\.$/i.test(before)) continue;
    return at + match[0].length;
  }
  return -1;
}

export function createVoiceTurn(options: {
  enabled: () => boolean;
  full: () => boolean;
}): VoiceTurn {
  let runId = "";
  let generation = 0;
  let readAt = 0;
  let opened = false;
  const muted = new Set<string>();
  const pending: string[] = [];
  let pumping = false;
  /** Quiet after an interruption, so her next sentence does not talk over them. */
  let hushUntil = 0;

  /**
   * Play the queue in order, fetching the next line while this one speaks.
   * A generation bump (new turn, interrupt, reset) abandons the queue.
   */
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    let ahead: Promise<PreparedSpeech | null> | null = null;
    try {
      while (pending.length) {
        const at = generation;
        const text = pending.shift() as string;
        const prepared = await (ahead ?? prepareSpeech(text).catch(() => null));
        ahead = null;
        if (at !== generation) continue;
        if (!prepared) continue;
        // Still inside the hush window: skip this line rather than talk over them.
        if (Date.now() < hushUntil) continue;
        // The following line starts synthesising now, while this one plays.
        if (pending.length) ahead = prepareSpeech(pending[0]).catch(() => null);
        // A clip that cannot play must not silence the rest of the answer.
        await playPrepared(prepared).catch(() => undefined);
      }
    } finally {
      pumping = false;
    }
  };

  const queue = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    pending.push(clean);
    void pump();
  };

  const clear = () => {
    generation++;
    pending.length = 0;
    readAt = 0;
    opened = false;
    hushUntil = 0;
  };

  const begin = (id: string) => {
    stopSpeech();
    clear();
    runId = id;
    if (muted.size > 12) muted.clear();
  };

  return {
    delta(id, text) {
      if (!options.enabled() || muted.has(id)) return;
      if (id !== runId) begin(id);
      if (muted.has(id)) return;

      if (!options.full()) {
        if (opened) return;
        const clean = briefFor(text);
        if (!clean || !/[.!?]["'”)]?$/.test(clean)) return;
        opened = true;
        queue(clean);
        return;
      }

      // Conversation mode: read the reply as it arrives, sentence by sentence.
      //
      // The offset is in the *raw* stream, not in its cleaned form. Cleaning
      // (") a growing string changes earlier characters — a `**` only
      // disappears once its closing pair arrives — and an offset into that
      // moving text skipped whole sentences. Raw offsets cannot move.
      let consumed = 0;
      while (readAt + consumed < text.length) {
        const fresh = text.slice(readAt + consumed);
        const trimmed = fresh.trimStart();
        const leading = fresh.length - trimmed.length;
        const end = firstSentenceEnd(trimmed);
        if (end < 0) break;
        const line = trimmed.slice(0, end);
        consumed += leading + end;
        if (line.trim()) queue(line);
        if (readAt + consumed > MAX_SPOKEN) break;
      }
      readAt += consumed;
      opened = true;
      if (readAt > MAX_SPOKEN) {
        // Do not read a document aloud. The rest is on screen.
        muted.add(id);
      }
    },

    done(id, text) {
      if (!options.enabled() || muted.has(id)) return;
      if (id !== runId) begin(id);
      if (muted.has(id)) return;

      if (!options.full()) {
        if (opened) return;
        const clean = briefFor(text);
        if (!clean) return;
        opened = true;
        queue(clean);
        return;
      }

      const rest = text.slice(readAt).trim();
      readAt = text.length;
      if (rest) queue(rest.slice(0, MAX_SPOKEN));
    },

    reset() {
      clear();
      stopSpeech();
      runId = "";
    },

    silence() {
      // Stop what is playing and drop what is waiting, but keep the reading
      // position: her next sentence resumes from here instead of starting the
      // answer again. A false positive (her own echo) must not leave her mute
      // for the rest of the turn.
      pending.length = 0;
      hushUntil = Date.now() + 2500;
      stopSpeech();
    },

    restart(id) {
      pending.length = 0;
      generation++;
      readAt = 0;
      opened = false;
      hushUntil = 0;
      runId = id;
    },
  };
}

/** The opening thought, with the throat-clearing removed. */
function briefFor(text: string): string {
  const clean = sentences(spokenForVoice(text))
    .map((line) =>
      line
        .replace(/^(?:sure|certainly|of course|absolutely|great question|happy to help)[,.!]?\s*/i, "")
        .replace(/^here(?:'s| is) (?:what|how|the|a)[^:.!?]*[:.]\s*/i, "")
        .trim(),
    )
    .filter((line) => line.length > 1)
    .slice(0, 2)
    .join(" ");
  return clean.slice(0, 340);
}

/** Kept for callers that just want one line read now. */
export async function sayNow(text: string) {
  await speakText(text);
}
