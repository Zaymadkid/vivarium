/**
 * TIDYING WHAT SHE SAYS.
 *
 * Language models repeat. A phrase that was useful in one paragraph gets said
 * again in the next, a closing line arrives twice, and a loop can leave the same
 * three sentences sitting in a row. Prompting helps, but a prompt is not a
 * guarantee — so the last thing before an answer is stored, read aloud or
 * remembered is a cheap, conservative pass:
 *
 *   - an exact repeat of a sentence already said in this answer is dropped;
 *   - a paragraph identical to an earlier one is dropped;
 *   - the stock assistant closers (“Let me know if…”, “Hope this helps”) go;
 *   - code blocks, diagrams and tables are never touched.
 *
 * It never rewrites a sentence, never merges two thoughts and never shortens
 * beyond removing what was already there. A person can hear the difference
 * between editing and de-duplication.
 */

const BOILERPLATE = [
  /^(?:let me know if|let me know how|hope (?:this|that) helps|is there anything else|feel free to (?:ask|reach out)|happy to help(?: further)?|i hope this helps)\b/i,
  /^(?:as an ai|i am an ai|i'm an ai|as a language model)\b/i,
  /^(?:would you like me to|do you want me to)\b.*\?$/i,
];

const keyOf = (sentence: string) =>
  sentence
    .toLowerCase()
    .replace(/[`*_#>]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function sentencesOf(paragraph: string): string[] {
  return paragraph.match(/[^.!?\n]+(?:[.!?]+["'”’)\]]?|$)/g) ?? [paragraph];
}

function tidyProse(block: string): string {
  const paragraphs = block.split(/\n{2,}/);
  const seenParagraphs = new Set<string>();
  const seenSentences = new Set<string>();

  const kept = paragraphs
    .map((paragraph) => {
      const key = keyOf(paragraph);
      if (!key) return paragraph.trim();
      if (seenParagraphs.has(key)) return "";
      seenParagraphs.add(key);

      // A CLI hop can end a sentence and start the next one with no space. That
      // is what makes an answer read like “for you.Here is…” instead of prose.
      const rows = sentencesOf(paragraph.replace(/([.!?])(?=[A-Z][a-z])/g, "$1 "));
      const out: string[] = [];
      for (const raw of rows) {
        const sentence = raw.trim();
        if (!sentence) continue;
        if (BOILERPLATE.some((pattern) => pattern.test(sentence))) continue;
        const sentenceKey = keyOf(sentence);
        if (!sentenceKey) {
          out.push(sentence);
          continue;
        }
        if (seenSentences.has(sentenceKey)) continue;
        seenSentences.add(sentenceKey);
        out.push(sentence);
      }
      if (out.length === 0) return "";
      // A preamble that only announces the work ("I'll look at…") is not part
      // of the answer. Drop it only when a real sentence follows.
      if (
        out.length > 1 &&
        /^I(?:'ll| will) (?:look|check|read|take|open|search|try|pull|grab|find)\b/i.test(out[0])
      ) {
        out.shift();
      }
      // Rebuild with the original line breaks inside the paragraph so a short
      // list stays a list rather than becoming one run-on line.
      const hadLines = paragraph.includes("\n");
      return hadLines ? out.join("\n") : out.join(" ");
    })
    .filter((paragraph) => paragraph.trim().length > 0);

  return kept.join("\n\n");
}

export function tidyAnswer(input: string): string {
  const text = String(input ?? "");
  if (!text.trim()) return text;
  // Fenced blocks are code, JSON diagrams or paths. Mask them with a token in
  // their own paragraph, tidy the prose around them, then put them back byte for
  // byte — a tidy pass must never eat a bracket or collapse code indentation.
  const blocks: string[] = [];
  const masked = text.replace(/```[\s\S]*?```/g, (block) => {
    blocks.push(block);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  const cleaned = tidyProse(masked)
    .replace(/\u0000BLOCK(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A model that looped can also leave the same trailing paragraph after the
  // pass above; trim a literal repeat at the very end once more.
  const tail = cleaned.split(/\n{2,}/);
  if (tail.length > 1) {
    const last = keyOf(tail[tail.length - 1]);
    const before = keyOf(tail[tail.length - 2]);
    if (last && last === before) tail.pop();
  }
  return tail.join("\n\n").trim() || text.trim();
}
