import type { DiagramEdge, DiagramKind, DiagramNode, DiagramSpec } from "../../../shared/types";

/**
 * DIAGRAMS THE MODEL ASSEMBLES ITSELF.
 *
 * The model does not draw pixels. It writes a small JSON structure — nodes,
 * edges, optional detail — and this module turns that into a laid-out graph the
 * person can pan, zoom and click. That keeps the answer legible at any window
 * size and lets a node open a detail panel instead of being a picture of text.
 *
 * Parsing is deliberately forgiving: a fence with one bad node is still a
 * diagram, and a fence that is not JSON is shown as text rather than swallowed.
 */

const KINDS = new Set<DiagramKind>(["start", "step", "decision", "data", "note", "warning"]);
const MAX_NODES = 24;

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

/** Turn whatever the model wrote into a spec safe to render, or null. */
export function normaliseDiagram(raw: unknown): DiagramSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const rows = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes: DiagramNode[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(0, MAX_NODES)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const label = text(item.label ?? item.name ?? item.title, 90);
    if (!label) continue;
    let id = text(item.id, 40) || `n${nodes.length + 1}`;
    while (seen.has(id)) id = `${id}_${nodes.length + 1}`;
    seen.add(id);
    const kind = typeof item.kind === "string" && KINDS.has(item.kind as DiagramKind)
      ? (item.kind as DiagramKind)
      : undefined;
    const detail = text(item.detail ?? item.description ?? item.note, 420);
    nodes.push({ id, label, ...(kind ? { kind } : {}), ...(detail ? { detail } : {}) });
  }

  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((node) => node.id));
  const edgeRows = Array.isArray(source.edges) ? source.edges : [];
  const edges: DiagramEdge[] = [];
  for (const row of edgeRows.slice(0, MAX_NODES * 2)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const from = text(item.from ?? item.source, 40);
    const to = text(item.to ?? item.target, 40);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
    const label = text(item.label, 32);
    edges.push({ from, to, ...(label ? { label } : {}), ...(item.dashed ? { dashed: true } : {}) });
  }

  const direction = source.direction === "tb" ? "tb" : "lr";
  const title = text(source.title, 90);
  return { ...(title ? { title } : {}), direction, nodes, edges };
}

export interface DiagramPiece {
  kind: "diagram";
  spec: DiagramSpec;
  raw: string;
}

export interface TextPiece {
  kind: "text";
  text: string;
}

export type Piece = DiagramPiece | TextPiece;

const FENCE = /```(?:diagram|flowchart|chart)\s*\r?\n([\s\S]*?)```/gi;
const OPEN_FENCE = /```(?:diagram|flowchart|chart)\b/i;

/**
 * Split an answer into prose and diagrams. An unclosed fence is reported as
 * pending so the chat can draw a skeleton instead of flashing raw JSON while the
 * model is still writing.
 */
export function readDiagramText(source: string): { pieces: Piece[]; pending: boolean } {
  const pieces: Piece[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  FENCE.lastIndex = 0;

  while ((match = FENCE.exec(source))) {
    if (match.index > last) {
      const before = source.slice(last, match.index);
      if (before.trim()) pieces.push({ kind: "text", text: before });
    }
    let spec: DiagramSpec | null = null;
    try {
      spec = normaliseDiagram(JSON.parse(match[1]));
    } catch {
      spec = null;
    }
    if (spec) pieces.push({ kind: "diagram", spec, raw: match[0] });
    else pieces.push({ kind: "text", text: match[0] });
    last = FENCE.lastIndex;
  }

  let tail = source.slice(last);
  let pending = false;
  const open = tail.search(OPEN_FENCE);
  if (open >= 0) {
    const before = tail.slice(0, open);
    if (before.trim()) pieces.push({ kind: "text", text: before });
    tail = "";
    pending = true;
  }
  if (tail.trim()) pieces.push({ kind: "text", text: tail });
  return { pieces, pending };
}

/* --------------------------------------------------------------------- layout */

const NODE_W = 188;
const NODE_H = 58;
const GAP_X = 92;
const GAP_Y = 30;
const PAD = 44;

export interface PlacedNode extends DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge {
  edge: DiagramEdge;
  path: string;
}

export interface DiagramLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  direction: "lr" | "tb";
}

/**
 * A layered layout: roots on the left, children one column to the right. Cycles
 * are tolerated (a node already on the current walk contributes rank 0), so a
 * feedback loop does not hang the renderer.
 */
export function layoutDiagram(spec: DiagramSpec): DiagramLayout {
  const order = new Map(spec.nodes.map((node, index) => [node.id, index]));

  // A loop (review → fix → review) must not push the whole graph sideways, so
  // rank on the spanning forest and keep the back edges for drawing only.
  const outgoing = new Map<string, string[]>();
  for (const edge of spec.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const colour = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    colour.set(id, 1);
    for (const next of outgoing.get(id) ?? []) {
      const state = colour.get(next) ?? 0;
      if (state === 1) back.add(`${id}->${next}`);
      else if (state === 0) visit(next);
    }
    colour.set(id, 2);
  };
  for (const node of spec.nodes) if ((colour.get(node.id) ?? 0) === 0) visit(node.id);

  const parents = new Map<string, string[]>();
  for (const edge of spec.edges) {
    if (back.has(`${edge.from}->${edge.to}`)) continue;
    const list = parents.get(edge.to) ?? [];
    list.push(edge.from);
    parents.set(edge.to, list);
  }

  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const ready = ranks.get(id);
    if (ready !== undefined) return ready;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let rank = 0;
    for (const parent of parents.get(id) ?? []) {
      if (!order.has(parent)) continue;
      rank = Math.max(rank, rankOf(parent) + 1);
    }
    visiting.delete(id);
    const capped = Math.min(rank, spec.nodes.length - 1);
    ranks.set(id, capped);
    return capped;
  };
  for (const node of spec.nodes) rankOf(node.id);

  const columns = new Map<number, DiagramNode[]>();
  for (const node of spec.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const list = columns.get(rank) ?? [];
    list.push(node);
    columns.set(rank, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  const placed: PlacedNode[] = [];
  const direction = spec.direction ?? "lr";
  const maxDepth = Math.max(0, ...[...columns.keys()]);
  const deepest = columns.get(maxDepth)?.length ?? 1;

  for (const [rank, list] of columns) {
    list.forEach((node, index) => {
      const span = direction === "lr" ? list.length : deepest;
      const offset = (index - (span - 1) / 2) * ((direction === "lr" ? NODE_H + GAP_Y : NODE_W + GAP_X));
      placed.push({
        ...node,
        w: NODE_W,
        h: NODE_H,
        x: direction === "lr" ? rank * (NODE_W + GAP_X) : offset,
        y: direction === "lr" ? offset : rank * (NODE_H + GAP_Y),
      });
    });
  }

  // Shift into positive space so an SVG viewBox is simple.
  const minX = Math.min(...placed.map((node) => node.x));
  const minY = Math.min(...placed.map((node) => node.y));
  for (const node of placed) {
    node.x += PAD - minX;
    node.y += PAD - minY;
  }
  const width = Math.max(...placed.map((node) => node.x + node.w)) + PAD;
  const height = Math.max(...placed.map((node) => node.y + node.h)) + PAD;

  const byId = new Map(placed.map((node) => [node.id, node]));
  const edges: PlacedEdge[] = [];
  for (const edge of spec.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    let path: string;
    if (direction === "lr") {
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      const bend = Math.max(36, Math.abs(x2 - x1) / 2);
      path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    } else {
      const x1 = from.x + from.w / 2;
      const y1 = from.y + from.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      const bend = Math.max(36, Math.abs(y2 - y1) / 2);
      path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    }
    edges.push({ edge, path });
  }

  return { nodes: placed, edges, width, height, direction };
}
