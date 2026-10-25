import { dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { VaultDocument, VaultHit } from "../shared/types";

/**
 * THE RECALL VAULT.
 *
 * Documents the person gives her, split into citable passages and searched
 * locally with BM25. No embeddings service, no network, no account: the index is
 * a JSON file next to the rest of this machine's data, and every hit names the
 * document and passage it came from so an answer can be checked.
 *
 * Imports are best-effort by design. Text, Markdown, notes, code and CSV are
 * exact; HTML is stripped; DOCX and PDF are read with small local extractors
 * that cover ordinary documents and say so when a file has no readable text.
 */

interface Chunk {
  id: string;
  documentId: string;
  index: number;
  text: string;
}

interface VaultFile {
  documents: VaultDocument[];
  chunks: Chunk[];
}

const MAX_BYTES = 25_000_000;
const MAX_CHARS = 900_000;
const CHUNK = 1500;
const OVERLAP = 180;
const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".log", ".xml", ".yaml", ".yml",
  ".ini", ".cfg", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py",
  ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".cs", ".sh", ".ps1", ".sql", ".toml", ".env",
]);

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was", "were", "are",
  "you", "your", "our", "its", "their", "but", "not", "can", "will", "would", "should", "could",
  "into", "about", "after", "before", "then", "than", "them", "they", "there", "here", "what",
  "when", "where", "which", "who", "how", "why", "all", "any", "one", "two", "out", "use", "using",
  "get", "got", "make", "made", "just", "like", "also", "more", "most", "some", "such", "only",
]);

const cleanToken = (token: string) => token.replace(/^[._+#-]+|[._+#-]+$/g, "");

const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One entry out of a zip, for .docx. Sizes in a data-descriptor zip are handled
 * by falling back to the central directory only when needed — Word writes them. */
function zipEntry(buf: Buffer, wanted: string): Buffer | null {
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    // Some Windows zip writers store `word\\document.xml`; DOCX addresses it
    // with forward slashes, so normalise before comparing.
    const name = buf.toString("utf8", i + 30, i + 30 + nameLen).replace(/\\/g, "/");
    const start = i + 30 + nameLen + extraLen;
    if (name !== wanted) continue;
    if (compSize === 0) return null;
    const data = buf.subarray(start, start + compSize);
    try {
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
}

function docxText(buf: Buffer): string | null {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) return null;
  const text = xml
    .toString("utf8")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

/** Best-effort text from a PDF's content streams: the common Flate + Tj/TJ case. */
function pdfText(buf: Buffer): string | null {
  const raw = buf.toString("latin1");
  const pieces: string[] = [];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const slice = buf.subarray(start, end);
    let body: string;
    try {
      body = zlib.inflateSync(slice).toString("latin1");
    } catch {
      body = slice.toString("latin1");
    }
    if (!/\bT[Jj]\b/.test(body)) continue;
    const textRe = /\((?:\\.|[^\\()])*\)|\bT[dD]\b|\bT\*\b|\bET\b/g;
    let token: RegExpExecArray | null;
    let line = "";
    while ((token = textRe.exec(body))) {
      const value = token[0];
      if (value.startsWith("(")) {
        line += value
          .slice(1, -1)
          .replace(/\\([nrtbf()\\])/g, (_m, c) =>
            c === "n" ? "\n" : c === "r" ? "\n" : c === "t" ? "\t" : c === "b" ? "" : c,
          )
          .replace(/\\(\d{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
      } else if (value === "T*" || value === "ET" || value === "Td" || value === "TD") {
        if (line.trim()) pieces.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) pieces.push(line.trim());
  }
  if (pieces.length === 0) return null;
  return pieces.join("\n").replace(/[ \t]{2,}/g, " ").trim();
}

function readDocument(file: string): { title: string; text: string } | null {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  const ext = path.extname(file).toLowerCase();
  const title = path.basename(file, ext);
  if (ext === ".docx") {
    const text = docxText(fs.readFileSync(file));
    return text && text.trim() ? { title, text } : null;
  }
  if (ext === ".pdf") {
    const text = pdfText(fs.readFileSync(file));
    return text && text.trim() ? { title, text } : null;
  }
  if (ext === ".doc") return null; // legacy binary format: no honest local reader
  const isText = TEXT_EXT.has(ext) || ext === "";
  if (!isText) return null;
  const buf = fs.readFileSync(file);
  // A NUL in the first 8 KB means binary, whatever the extension claims.
  if (buf.subarray(0, 8192).includes(0)) return null;
  const raw = buf.toString("utf8");
  const text = ext === ".html" || ext === ".htm" ? stripHtml(raw) : raw;
  if (!text.trim()) return null;
  return { title, text };
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").slice(0, MAX_CHARS);
  if (clean.length <= CHUNK) return [clean.trim()].filter(Boolean);
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK);
    if (end < clean.length) {
      // Prefer a paragraph, then a sentence, then a word boundary.
      const para = clean.lastIndexOf("\n\n", end);
      const line = clean.lastIndexOf("\n", end);
      const stop = clean.lastIndexOf(". ", end);
      if (para > start + CHUNK * 0.55) end = para;
      else if (line > start + CHUNK * 0.6) end = line;
      else if (stop > start + CHUNK * 0.7) end = stop + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - OVERLAP);
  }
  return chunks;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_+#.-]*/g) ?? [])
    .map(cleanToken)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const snippet = (text: string, query: string[]): string => {
  const lower = text.toLowerCase();
  let at = -1;
  for (const word of query) {
    const found = lower.indexOf(word);
    if (found >= 0) {
      at = found;
      break;
    }
  }
  if (at < 0) return text.slice(0, 360) + (text.length > 360 ? "…" : "");
  const start = Math.max(0, at - 160);
  const end = Math.min(text.length, at + 260);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
};

export class Vault {
  private documents: VaultDocument[] = [];
  private chunks: Chunk[] = [];
  private readonly file: string;
  /** Token lists, built once per document set; search is warm after the first. */
  private cache: { stamp: number; tokens: Map<string, string[]>; lengths: Map<string, number>; avg: number } | null = null;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "vault.json");
    this.load();
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<VaultFile>;
      this.documents = Array.isArray(parsed.documents) ? parsed.documents : [];
      this.chunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    } catch {
      this.documents = [];
      this.chunks = [];
    }
  }

  private persist() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ documents: this.documents, chunks: this.chunks }), "utf8");
    this.cache = null;
  }

  private index(title: string, source: string, kind: "note" | "file", text: string, tags: string[]): VaultDocument {
    const existing = this.documents.find((d) => d.source === source);
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      this.chunks = this.chunks.filter((c) => c.documentId !== id);
      this.documents = this.documents.filter((d) => d.id !== id);
    }
    const pieces = chunkText(text);
    pieces.forEach((piece, i) => {
      this.chunks.push({ id: crypto.randomUUID(), documentId: id, index: i + 1, text: piece });
    });
    const at = Date.now();
    const record: VaultDocument = {
      id,
      title: title.trim().slice(0, 160) || "Untitled",
      source,
      kind,
      tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 12),
      chars: text.length,
      chunks: pieces.length,
      at: existing?.at ?? at,
      updatedAt: at,
    };
    this.documents.push(record);
    return record;
  }

  list(): VaultDocument[] {
    return this.documents.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  status() {
    return { documents: this.documents.length, chunks: this.chunks.length, dir: this.dir };
  }

  add(input: { title?: string; body: string; tags?: string[] }): VaultDocument {
    const body = String(input.body ?? "");
    if (!body.trim()) throw new Error("A vault note needs some text.");
    const title = input.title?.trim() || body.split(/\n/)[0].slice(0, 80) || "Note";
    const doc = this.index(title, `note:${title.toLowerCase()}`, "note", body, input.tags ?? []);
    this.persist();
    return doc;
  }

  importPaths(files: string[]): { documents: VaultDocument[]; skipped: string[] } {
    const added: VaultDocument[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.isDirectory()) {
          const nested = this.importPaths(
            fs
              .readdirSync(file, { withFileTypes: true })
              .filter((entry) => !entry.name.startsWith("."))
              .map((entry) => path.join(file, entry.name)),
          );
          added.push(...nested.documents);
          skipped.push(...nested.skipped);
          continue;
        }
        const read = readDocument(file);
        if (!read) {
          skipped.push(path.basename(file));
          continue;
        }
        added.push(this.index(read.title, path.resolve(file), "file", read.text, []));
      } catch {
        skipped.push(path.basename(file));
      }
    }
    if (added.length) this.persist();
    return { documents: added, skipped };
  }

  async importFiles(): Promise<{ documents: VaultDocument[]; skipped: string[] }> {
    const picked = await dialog.showOpenDialog({
      title: "Add files to the vault",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Documents",
          extensions: ["txt", "md", "markdown", "pdf", "docx", "csv", "tsv", "json", "html", "htm", "log", "xml", "yaml", "yml"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { documents: [], skipped: [] };
    return this.importPaths(picked.filePaths);
  }

  async importFolder(): Promise<{ documents: VaultDocument[]; skipped: string[] }> {
    const picked = await dialog.showOpenDialog({
      title: "Add a folder to the vault",
      properties: ["openDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { documents: [], skipped: [] };
    return this.importPaths(picked.filePaths);
  }

  forget(id: string): VaultDocument[] {
    this.documents = this.documents.filter((d) => d.id !== id);
    this.chunks = this.chunks.filter((c) => c.documentId !== id);
    this.persist();
    return this.list();
  }

  /** BM25 over passages. Returns the passages, best first, each with its citation. */
  search(query: string, limit = 6): VaultHit[] {
    const words = [...new Set(tokens(query))];
    if (words.length === 0 || this.chunks.length === 0) return [];
    const stamp = this.documents.reduce((n, d) => n + d.updatedAt, 0);
    if (!this.cache || this.cache.stamp !== stamp) {
      const map = new Map<string, string[]>();
      const lengths = new Map<string, number>();
      let total = 0;
      for (const chunk of this.chunks) {
        const list = tokens(chunk.text);
        map.set(chunk.id, list);
        lengths.set(chunk.id, list.length);
        total += list.length;
      }
      this.cache = { stamp, tokens: map, lengths, avg: total / Math.max(1, this.chunks.length) };
    }
    const { tokens: map, lengths, avg } = this.cache;
    const k1 = 1.4;
    const b = 0.72;
    const df = new Map<string, number>();
    for (const word of words) {
      let n = 0;
      for (const list of map.values()) if (list.includes(word)) n++;
      df.set(word, n);
    }
    const scored: { chunk: Chunk; score: number }[] = [];
    for (const chunk of this.chunks) {
      const list = map.get(chunk.id) ?? [];
      if (list.length === 0) continue;
      const freq = new Map<string, number>();
      for (const token of list) freq.set(token, (freq.get(token) ?? 0) + 1);
      let score = 0;
      for (const word of words) {
        const f = freq.get(word) ?? 0;
        if (!f) continue;
        const n = df.get(word) ?? 0;
        const idf = Math.log(1 + (this.chunks.length - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * list.length) / Math.max(1, avg))));
      }
      if (score > 0) scored.push({ chunk, score });
    }
    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, limit).map(({ chunk, score }) => {
      const doc = this.documents.find((d) => d.id === chunk.documentId);
      return {
        documentId: chunk.documentId,
        title: doc?.title ?? "Untitled",
        source: doc?.source ?? "",
        chunk: chunk.index,
        text: snippet(chunk.text, words),
        score: Math.round(score * 100) / 100,
      };
    });
  }

  /** The text of one document, for the viewer. */
  read(id: string): { document: VaultDocument; text: string } | null {
    const document = this.documents.find((d) => d.id === id);
    if (!document) return null;
    return {
      document,
      text: this.chunks
        .filter((c) => c.documentId === id)
        .sort((a, b) => a.index - b.index)
        .map((c) => c.text)
        .join("\n\n"),
    };
  }
}
