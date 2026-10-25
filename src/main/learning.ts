import type { ChatEvent } from "../shared/types";
import { getProvider } from "./providers";
import type { Store } from "./store";

/**
 * LEARNING AFTER THE ANSWER.
 *
 * Two cheap passes, run once a turn has finished and the person has moved on:
 *
 *   1. heuristic — facts the person stated plainly ("my name is…", "I prefer…").
 *      This works with every provider, including the offline mock.
 *   2. model — a short JSON-only request that tidies those facts and, when the
 *      turn actually did something repeatable, writes it down as a skill.
 *
 * Neither pass can delay the answer: the run has already emitted `done`. Failures
 * are logged and dropped, because a turn that answered well should not be marked
 * broken by its note-taking.
 */

const FACT_SENTENCE =
  /(?:^|\b)(?:remember|note|keep in mind)(?: that)?\s+(.{8,240})|my name is\b|call me\b|i(?:'m| am) (?:a|an|the)\b|\bi (?:like|love|prefer|hate|dislike|use|need)\b|\bi work (?:at|for|on|as)\b|\bi live in\b|\bi(?:'m| am) based in\b|my (?:favourite|favorite|preferred|main|current)\b[^.]*\bis\b|\bmy (?:project|company|business|team|job)\b|\b(?:we|i) (?:use|run|work with)\b|^actually\b|\bi no longer\b|\bnot .{2,40} anymore\b|\bi (?:stopped|switched|changed|moved)\b/i;

/** Facts a sentence states, without asking a model. */
export function heuristicFacts(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 240 && !s.endsWith("?"));
  const out: string[] = [];
  for (const sentence of sentences) {
    if (!FACT_SENTENCE.test(sentence)) continue;
    const clean = sentence
      .replace(/^(?:please\s+)?(?:remember|note|keep in mind)(?:\s+that)?\s+/i, "")
      .replace(/^[-•]\s*/, "")
      .trim();
    if (clean.length >= 8) out.push(clean);
  }
  return [...new Set(out)].slice(0, 4);
}

interface LearnedSkill {
  name: string;
  description: string;
  instructions: string;
}

interface LearnResult {
  memories: string[];
  skill: LearnedSkill | null;
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askModel(
  store: Store,
  prompt: string,
  answer: string,
  tools: string[],
): Promise<LearnResult | null> {
  const settings = store.getSettings();
  // Mock has nothing to add; every real mind — hosted, local or CLI — can read
  // one finished turn and return the small JSON note-taking request. A CLI does
  // spawn for this pass, which is why it runs after the answer, never before it.
  if (settings.provider === "mock") return null;
  const provider = getProvider(settings.provider);
  const known = store
    .listMemory()
    .slice(-24)
    .map((m) => `- ${m.text}`)
    .join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let text = "";
  try {
    for await (const event of provider.chat({
      runId: `learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messages: [
        {
          role: "system",
          content:
            "You keep the long-term memory of a local desktop agent. Read one finished turn and return strict JSON only.\n" +
            'Shape: {"memories":["..."],"skill":{"name":"...","description":"...","instructions":"..."}}\n' +
            "A memory is a durable fact about the user: name, preferences, people, projects, tools, routines, goals. " +
            "Write each in the third person about the user, under 200 characters. Never store secrets, one-off states, " +
            "or anything the assistant said about itself. Update an existing fact rather than repeating a near-duplicate. " +
            "A skill is only for a procedure that was actually completed and is likely to be asked for again; keep it " +
            "under 900 characters, numbered steps, and mention where a step needs confirmation. If the turn was small " +
            'talk or produced nothing durable, return {"memories":[],"skill":null}. Maximum three memories.',
        },
        {
          role: "user",
          content: [
            known ? `Facts already known:\n${known}` : "No facts stored yet.",
            `User said:\n${prompt.slice(0, 2500)}`,
            `The answer:\n${answer.slice(0, 3500)}`,
            tools.length ? `Tools used: ${tools.join(", ")}` : "No tools were used.",
          ].join("\n\n"),
        },
      ],
      tools: [],
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: store.getApiKey(),
      cliCommand: settings.cliCommand,
      signal: controller.signal,
    })) {
      if (event.type === "text") text += event.text;
      if (event.type === "error") throw new Error(event.message);
    }
  } catch (err) {
    console.info(`[learning] model pass skipped: ${String(err).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseJson(text) as {
    memories?: unknown;
    skill?: { name?: unknown; description?: unknown; instructions?: unknown } | null;
  } | null;
  if (!parsed) return null;
  const memories = Array.isArray(parsed.memories)
    ? parsed.memories
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter((m) => m.length >= 8 && m.length <= 300)
        .slice(0, 3)
    : [];
  const skill =
    parsed.skill &&
    typeof parsed.skill.name === "string" &&
    typeof parsed.skill.instructions === "string" &&
    parsed.skill.instructions.trim().length > 20
      ? {
          name: parsed.skill.name.trim().slice(0, 70),
          description: String(parsed.skill.description ?? "").trim().slice(0, 240),
          instructions: parsed.skill.instructions.trim().slice(0, 2000),
        }
      : null;
  return { memories, skill };
}

/** The procedure that just worked, written down without a model. */
function procedureSkill(prompt: string, tools: string[]): LearnedSkill {
  const goal = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const name = `How to ${goal.replace(/^(?:please\s+)?/i, "").slice(0, 54).replace(/[.?!]+$/, "")}`;
  return {
    name: name.slice(0, 64),
    description: `A procedure learned from a request: ${goal.slice(0, 120)}`,
    instructions: [
      `When the user asks for something like: “${goal}”`,
      "The steps that worked here, in order:",
      ...tools.map((t, i) => `${i + 1}. ${t.replace(/_/g, " ")}`),
      "Confirm before a step that writes a file or runs a command, and check each result before the next step.",
    ].join("\n"),
  };
}

/**
 * Take one finished turn and keep what is worth keeping. Emits `learned` so the
 * chat can say so instead of quietly growing a memory.
 */
export async function learnFromTurn(input: {
  store: Store;
  prompt: string;
  answer: string;
  tools: string[];
  runId: string;
  emit?: (event: ChatEvent) => void;
}): Promise<{ memories: number; skill?: string }> {
  const { store, prompt, answer, tools, runId, emit } = input;
  const learning = store.getSettings().learning ?? { memory: true, skills: true };
  if (!learning.memory && !learning.skills) return { memories: 0 };
  if (prompt.trim().length < 8 || answer.trim().length < 12) return { memories: 0 };

  let facts = learning.memory ? heuristicFacts(prompt) : [];
  let skill: LearnedSkill | null = null;

  // Rehearsal and test turns (“reply with exactly…”, “say PONG”) teach nothing
  // durable; running the note-taking pass on them is how a memory fills with
  // noise that later leaks back into every answer.
  if (/^(?:reply|say|answer|repeat) (?:with|the word)\b|^test\b|^ping$/i.test(prompt.trim())) {
    return { memories: 0 };
  }

  const modelled = await askModel(store, prompt, answer, tools);
  if (modelled) {
    if (learning.memory && modelled.memories.length) {
      // The model's phrasing is the better record; the heuristic is a fallback,
      // not a second copy sitting beside it. Drop observations about the
      // assistant's own face (the orb, the panel) — those are not facts about
      // the person and they go stale.
      facts = modelled.memories.filter(
        (fact) => !/\b(?:glowing|orb|chat panel|assistant'?s icon)\b/i.test(fact),
      );
    }
    if (learning.skills) skill = modelled.skill;
  }

  // Offline fallback: a turn that needed real work gets written down as a
  // procedure. Two tool calls is the line between answering and doing.
  if (learning.skills && !skill && tools.length >= 3) {
    skill = procedureSkill(prompt, tools);
  }

  let kept = 0;
  if (learning.memory) {
    for (const fact of facts) {
      const result = store.learnFact(fact);
      if (result?.added) kept += 1;
    }
  }

  let skillName: string | undefined;
  if (learning.skills && skill) {
    // Repeating the same job updates its one row and counts a use rather than
    // littering the shelf with near-identical skills.
    const existing = store
      .listSkills()
      .find((s) => s.name.toLowerCase() === skill!.name.toLowerCase());
    const saved = store.saveSkill({
      id: existing?.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      source: "learned",
      uses: (existing?.uses ?? 0) + 1,
    });
    skillName = saved.name;
  }

  if (kept > 0 || skillName) {
    console.info(`[learning] kept ${kept} fact(s)${skillName ? ` and skill “${skillName}”` : ""}`);
    emit?.({ type: "learned", runId, memories: kept, skill: skillName });
  }
  return { memories: kept, skill: skillName };
}
