import type { WorkflowRecord, WorkflowStrategy } from "../shared/types";

/**
 * MINING A WORKFLOW.
 *
 * A capable model can answer one task five different ways. Most of those ways
 * are never measured: the answer looks fine, the app forgets, and tomorrow it
 * guesses again. This module keeps a small bandit per task shape.
 *
 * Each approach is a strategy, not a hard-coded plan:
 *   direct     answer immediately, no tool unless needed
 *   plan       write a short plan, then execute it
 *   tool-first inspect the machine or files before answering
 *   research   read sources first, then answer
 *   clarify    ask one question when the request is genuinely ambiguous
 *
 * A successful finished run is a win. The first few turns on a new task shape
 * explore the untried strategies; once every approach has a result, the one with
 * the best record is injected into the system prompt. The counters live in
 * workflows.json, so the mining survives a restart.
 */

export const WORKFLOW_STRATEGIES: WorkflowStrategy[] = [
  "direct",
  "plan",
  "tool-first",
  "research",
  "clarify",
];

export const STRATEGY_INSTRUCTION: Record<WorkflowStrategy, string> = {
  direct: "Answer directly. Do not write a plan first; use a tool only if the request truly needs one.",
  plan: "Plan silently in 2–4 steps, do them in order, then give only the result. Never print the plan or narrate the steps unless the person asked for a plan.",
  "tool-first":
    "Look at the actual machine state first — files, folders, tabs or screen — then answer from what you found. Do not describe the inspection; just use what it told you.",
  research: "Gather evidence first and answer from it. Cite a source only when the claim needs one; never narrate the search.",
  clarify: "If one detail genuinely changes the answer, ask one short question first. Otherwise proceed without ceremony.",
};

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "your", "you", "please",
  "can", "could", "would", "should", "have", "has", "had", "will", "just", "then", "than", "there",
  "what", "when", "where", "which", "while", "make", "made", "get", "got", "use", "using", "how",
  "all", "any", "some", "one", "two", "its", "it's", "our", "out", "but", "not", "are", "was",
]);

export function taskKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
  return [...new Set(words)].slice(0, 10);
}

export function taskLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 96 ? `${clean.slice(0, 96)}…` : clean;
}

/** How much a stored workflow resembles the current request. */
function matchScore(keywords: string[], record: WorkflowRecord): number {
  if (keywords.length === 0 || record.keywords.length === 0) return 0;
  const current = new Set(keywords);
  const overlap = record.keywords.filter((word) => current.has(word)).length;
  if (overlap < 2) return 0;
  const union = new Set([...keywords, ...record.keywords]).size;
  return overlap / union;
}

interface StrategyStat {
  attempts: number;
  successes: number;
  totalMs: number;
  tools: string[];
}

function stats(records: WorkflowRecord[]): Map<WorkflowStrategy, StrategyStat> {
  const map = new Map<WorkflowStrategy, StrategyStat>();
  for (const record of records) {
    const current = map.get(record.strategy) ?? {
      attempts: 0,
      successes: 0,
      totalMs: 0,
      tools: [],
    };
    current.attempts += record.attempts;
    current.successes += record.successes;
    current.totalMs += record.totalMs;
    current.tools.push(...record.tools);
    map.set(record.strategy, current);
  }
  return map;
}

export interface WorkflowPlan {
  strategy: WorkflowStrategy;
  /** Similar records, best first, for the prompt and the UI. */
  matches: WorkflowRecord[];
  /** The record a new outcome should be added to, if this strategy already exists. */
  existing?: WorkflowRecord;
  reason: string;
}

/** A first guess for a task shape with no history. */
function openingStrategy(keywords: string[], prompt: string): WorkflowStrategy {
  if (/\b(?:research|compare|source|cite|look up|latest|news)\b/i.test(prompt)) return "research";
  if (/\b(?:file|folder|screen|tab|browser|read|open|find|check)\b/i.test(prompt)) return "tool-first";
  if (/\b(?:build|create|make|write|plan|implement|design|fix)\b/i.test(prompt) || keywords.length >= 8) {
    return "plan";
  }
  if (/\b(?:maybe|something|somehow|whatever|not sure|either)\b/i.test(prompt)) return "clarify";
  return "direct";
}

/**
 * Choose the approach for this turn. Exploration is deliberate: a strategy with
 * no result yet is tried once before the best known one is reused.
 */
export function planWorkflow(
  records: WorkflowRecord[],
  prompt: string,
  provider: string,
  model: string,
): WorkflowPlan {
  const keywords = taskKeywords(prompt);
  const matches = records
    .map((record) => ({ record, score: matchScore(keywords, record) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.record.successes / Math.max(1, b.record.attempts) - a.record.successes / Math.max(1, a.record.attempts))
    .slice(0, 8)
    .map((entry) => entry.record);

  if (matches.length === 0) {
    const strategy = openingStrategy(keywords, prompt);
    return { strategy, matches: [], reason: "No similar task in the workflow ledger yet — this run is an exploration." };
  }

  const grouped = stats(matches);
  const untried = WORKFLOW_STRATEGIES.find((strategy) => (grouped.get(strategy)?.attempts ?? 0) === 0);
  if (untried) {
    return {
      strategy: untried,
      matches,
      reason: `Similar tasks have not tried “${untried}” yet, so this run explores it.`,
    };
  }

  const ranked = WORKFLOW_STRATEGIES.map((strategy) => {
    const stat = grouped.get(strategy);
    return {
      strategy,
      stat,
      rate: stat ? stat.successes / Math.max(1, stat.attempts) : 0,
      avgMs: stat ? stat.totalMs / Math.max(1, stat.attempts) : Number.POSITIVE_INFINITY,
    };
  }).filter((row) => row.stat && row.stat.attempts > 0);
  ranked.sort((a, b) => b.rate - a.rate || a.avgMs - b.avgMs);
  const best = ranked[0];
  const existing = matches.find(
    (record) =>
      record.strategy === best.strategy &&
      record.provider === provider &&
      record.model === model,
  ) ?? matches.find((record) => record.strategy === best.strategy);

  return {
    strategy: best.strategy,
    matches,
    existing,
    reason: `“${best.strategy}” has the best record for this kind of task (${best.stat!.successes}/${best.stat!.attempts} completed).`,
  };
}

/** A compact block for the system prompt. Empty when there is nothing to say. */
export function workflowPrompt(plan: WorkflowPlan, provider: string): string {
  const lines = [
    `Approach for this turn: ${STRATEGY_INSTRUCTION[plan.strategy]}`,
    `Why: ${plan.reason}`,
  ];
  if (plan.matches.length > 0) {
    const seen = new Set<string>();
    const rows = plan.matches
      .filter((record) => {
        const key = `${record.strategy}:${record.provider}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)
      .map((record) => {
        const rate = Math.round((record.successes / Math.max(1, record.attempts)) * 100);
        const tools = record.tools.length ? `; tools ${record.tools.join(" → ")}` : "";
        return `- ${record.strategy} with ${record.provider}${record.provider === provider ? "" : " (other mind)"}: ${rate}% of ${record.attempts} run(s) completed${tools}`;
      });
    if (rows.length) lines.push(`Learned outcomes for similar tasks:\n${rows.join("\n")}`);
  }
  return lines.join("\n");
}
