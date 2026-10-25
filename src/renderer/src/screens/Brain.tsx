import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, MemoryEntry } from "../../../shared/types";
import { useDb } from "../shell/data";
import { Icon } from "../shell/icons";
import { openFileViewer } from "../shell/FileViewer";

/**
 * BRAIN — her memory, as the reference draws it.
 *
 * Everything on this screen is a view over records this machine already keeps:
 * memories (`memory.json`), knowledge (`db.docs`), conversations (`threads/main.json`)
 * and the topics those records share. The graph, the counts under "What's
 * stored", the time brush and the rows under "About" all read the same set, so
 * a filter applied anywhere narrows the others too.
 *
 * The scene is canvas, not WebGL: a starfield, a purple sea of dots and the
 * knowledge graph are all painted in one pass at device pixel ratio, which keeps
 * a 30 fps idle and 60 fps while dragging on integrated graphics.
 */

type Kind = "memory" | "topic" | "conversation" | "knowledge";

interface Node {
  id: string;
  kind: Kind;
  label: string;
  text: string;
  at: number;
  /** Position on the unit sphere before projection. */
  x: number;
  y: number;
  z: number;
  degree: number;
}

interface Edge {
  a: string;
  b: string;
}

const KIND_COLOR: Record<Kind, string> = {
  memory: "#a78bfa",
  topic: "#38bdf8",
  conversation: "#f4f4f5",
  knowledge: "#a3e635",
};

const KIND_LABEL: Record<Kind, string> = {
  memory: "Memory",
  topic: "Topic",
  conversation: "Conversation",
  knowledge: "Knowledge",
};

const DAY = 86_400_000;
const PRESETS = ["24h", "7d", "30d", "All"] as const;
type Preset = (typeof PRESETS)[number];

const PRESET_MS: Record<Preset, number> = {
  "24h": DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  All: 3650 * DAY,
};

const fmt = (t: number) => {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** Deterministic hash → 0..1, so a node keeps its position between renders. */
const hash = (s: string, salt = 0) => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};

export function BrainScreen({
  onOpenDocuments,
  onWorld,
  onPrev,
  onNext,
  onGo,
  page = 1,
}: {
  onOpenDocuments: () => void;
  onWorld: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onGo?: (index: number) => void;
  page?: number;
}) {
  const [db] = useDb();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [hidden, setHidden] = useState<Kind[]>([]);
  const [preset, setPreset] = useState<Preset>("All");
  const [range, setRange] = useState<[number, number]>(() => [Date.now() - PRESET_MS.All, Date.now()]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [orbit, setOrbit] = useState(true);
  const [labels, setLabels] = useState(true);
  const [mode, setMode] = useState<"rotate" | "pan">("rotate");
  const [zoom, setZoom] = useState(1);
  const [spin, setSpin] = useState(0);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    void window.viv.memory.list().then(setMemories);
    void window.viv.chat.history().then((rows) => setHistory(rows.slice(-80)));
  }, []);

  // The default range is "All", so once the records are in it has to snap to the
  // oldest of them; before that it would frame ten years of empty time.
  useEffect(() => {
    if (preset !== "All") return;
    const now = Date.now();
    const times = [...memories.map((m) => m.at), ...db.docs.map((d) => d.updatedAt || now), ...history.map((c) => c.at)];
    const oldest = times.length ? Math.min(...times) : now - 86_400_000;
    setRange([oldest, now]);
  }, [preset, memories, db.docs, history]);

  /* ---- the record set -------------------------------------------------- */

  const all = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Memories, then the topics they share with knowledge. A topic node exists
    // only where something points at it, which is what keeps the graph honest:
    // no empty hubs invented to make the picture busier.
    for (const m of memories) {
      nodes.push({
        id: `m:${m.id}`,
        kind: "memory",
        label: m.text.replace(/\s+/g, " ").slice(0, 64),
        text: m.text,
        at: m.at,
        x: 0,
        y: 0,
        z: 0,
        degree: 0,
      });
    }

    for (const d of db.docs) {
      const at = d.updatedAt || Date.now();
      nodes.push({
        id: `k:${d.id}`,
        kind: "knowledge",
        label: d.title,
        text: d.body.slice(0, 700),
        at,
        x: 0,
        y: 0,
        z: 0,
        degree: 0,
      });
      // Only the tags the document actually carries. A word-frequency guess is
      // what used to put "error" and "provider" in the Brain as if they were
      // memories; a topic has to be something a record points at.
      for (const tag of d.tags) addTopic(tag, at, `k:${d.id}`);
    }

    // Conversations are the words actually exchanged, not tool audit rows: the
    // reference's "conversations" are what was said to her, so tool traffic must
    // not masquerade as memory.
    for (const c of history) {
      if (!c.content.trim()) continue;
      nodes.push({
        id: `c:${c.id}`,
        kind: "conversation",
        label: c.content.replace(/\s+/g, " ").slice(0, 64),
        text: `${c.role === "user" ? "You" : c.name || "Wren"}: ${c.content.slice(0, 700)}`,
        at: c.at,
        x: 0,
        y: 0,
        z: 0,
        degree: 0,
      });
    }

    function addTopic(name: string, at: number, from?: string) {
      const clean = name.trim().toLowerCase();
      if (!clean) return;
      let node = nodes.find((n) => n.kind === "topic" && n.label === clean);
      if (!node) {
        node = {
          id: `t:${clean}`,
          kind: "topic",
          label: clean,
          text: `Topic — ${clean}`,
          at,
          x: 0,
          y: 0,
          z: 0,
          degree: 0,
        };
        nodes.push(node);
      }
      node.at = Math.max(node.at, at);
      if (from && !edges.some((e) => (e.a === from && e.b === node.id) || (e.b === from && e.a === node.id))) {
        edges.push({ a: from, b: node.id });
      }
    }

    // A memory joins a tag only when the tag's own word appears in it. No new
    // topic is invented from prose, and no edge is drawn on a vague similarity.
    for (const m of memories) {
      const from = `m:${m.id}`;
      for (const t of nodes) {
        if (t.kind !== "topic") continue;
        if (m.text.toLowerCase().includes(t.label)) edges.push({ a: from, b: t.id });
      }
    }

    // Topics with no record behind them are dropped, and every pair of records
    // sharing a topic is joined, which is what gives the reference its mesh.
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.a);
      const b = nodes.find((n) => n.id === e.b);
      if (a) a.degree++;
      if (b) b.degree++;
    }

    // Fibonacci sphere placement: even, deterministic and cheap.
    const ordered = [...nodes].sort((a, b) => a.kind.localeCompare(b.kind));
    const golden = Math.PI * (3 - Math.sqrt(5));
    // A shell, not a solid ball: the reference spreads its records out to the
    // ring, and a sphere that reaches only 0.8 R leaves the rim empty.
    const shell = (x: number, y: number, z: number) => {
      const len = Math.hypot(x, y, z) || 1;
      return [x / len, (y / len) * 0.94, z / len] as const;
    };
    ordered.forEach((n, i) => {
      const y = 1 - (i / Math.max(1, ordered.length - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const jitter = 0.9 + hash(n.id) * 0.62;
      const theta = golden * i + hash(n.id, 7) * 0.5;
      const [ux, uy, uz] = shell(Math.cos(theta) * r, y * 0.86, Math.sin(theta) * r);
      n.x = ux * jitter;
      n.y = uy * jitter;
      n.z = uz * jitter;
    });

    return { nodes: ordered, edges };
  }, [memories, db.docs, history]);

  /* ---- filters --------------------------------------------------------- */

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return new Set(
      all.nodes
        .filter((n) => !hidden.includes(n.kind))
        .filter((n) => n.at >= range[0] && n.at <= range[1])
        .filter((n) => !q || `${n.label} ${n.text}`.toLowerCase().includes(q))
        .map((n) => n.id),
    );
  }, [all, hidden, range, query]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { memory: 0, topic: 0, conversation: 0, knowledge: 0 };
    for (const n of all.nodes) c[n.kind]++;
    return c;
  }, [all]);

  const about = useMemo(
    () =>
      all.nodes
        .filter((n) => n.kind === "topic" && n.degree > 0)
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 12),
    [all],
  );

  const shown = useMemo(() => all.nodes.filter((n) => matched.has(n.id)), [all, matched]);

  // 48 buckets across whatever the brush currently frames: the reference's
  // "When" chart is a real histogram of her records, not a decoration.
  const buckets = useMemo(() => {
    const slots = new Array<number>(48).fill(0);
    const span = Math.max(1, range[1] - range[0]);
    for (const n of all.nodes) {
      if (hidden.includes(n.kind)) continue;
      const i = Math.floor(((n.at - range[0]) / span) * 48);
      if (i >= 0 && i < 48) slots[i]++;
    }
    const max = Math.max(1, ...slots);
    return slots.map((v) => v / max);
  }, [all, range, hidden]);

  const dateLines = [fmt(range[0]), fmt(range[1])] as const;

  /* ---- canvas ---------------------------------------------------------- */

  const ref = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ yaw: 0.5, pitch: -0.22, panX: 0, panY: 0, zoom: 1, resume: 0, vYaw: 0, vPitch: 0 });
  const drag = useRef<{ x: number; y: number; kind: "orbit" | "pan" } | null>(null);
  const motion = useRef({ orbit, labels, selected, nodes: shown, edges: all.edges, matched, zoom, mode });
  motion.current = { orbit, labels, selected, nodes: shown, edges: all.edges, matched, zoom, mode };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.72,
      s: Math.random() * 1.5 + 0.4,
      p: Math.random() * Math.PI * 2,
    }));

    const paint = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const v = view.current;
      const m = motion.current;
      const spinning = m.orbit && !reduced;
      // Flick inertia: a released drag keeps turning and eases out, which is
      // what makes the constellation feel like a body rather than a slider.
      if (!drag.current) {
        v.yaw += v.vYaw * dt;
        v.pitch = Math.max(-1.15, Math.min(1.15, v.pitch + v.vPitch * dt));
        v.vYaw *= Math.pow(0.06, dt);
        v.vPitch *= Math.pow(0.02, dt);
        if (Math.abs(v.vYaw) < 0.002) v.vYaw = 0;
        if (Math.abs(v.vPitch) < 0.002) v.vPitch = 0;
      }
      if (spinning && !drag.current) v.yaw += dt * 0.16;

      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#05030c");
      sky.addColorStop(0.55, "#080515");
      sky.addColorStop(1, "#0a0618");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      for (const s of stars) {
        const a = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 1.1 + s.p));
        ctx.fillStyle = `rgba(196,180,255,${a})`;
        ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
      }

      // Sea — dotted contour waves in the reference's purple, with perspective:
      // rows crowd toward the horizon and each row's dots spread with depth.
      const horizon = h * 0.54;
      const haze = ctx.createLinearGradient(0, horizon - h * 0.1, 0, h);
      haze.addColorStop(0, "rgba(24,18,52,0)");
      haze.addColorStop(0.35, "rgba(38,30,82,0.55)");
      haze.addColorStop(1, "rgba(22,16,48,0.9)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - h * 0.1, w, h - horizon + h * 0.1);

      // A real plane in front of a camera, sampled as dots: rows crowd toward
      // the horizon because their depth increases, not because they are
      // spread by hand. Heights come from three crossing sines, which is what
      // makes the reference's water read as ridged bands.
      const rows = 110;
      const focal = h * 0.55;
      for (let r = 0; r < rows; r++) {
        const dz = 1.5 + Math.pow((r + 1) / rows, 2.2) * 16;
        const scale = 1 / dz;
        const fog = Math.max(0, Math.min(1, 1 - (dz - 1.6) / 12));
        const sy = horizon + focal * 1.5 * scale;
        if (sy > h + 14) continue;
        // Constant 7 px screen spacing: a dot per 7 px of width keeps the plane
        // square, so it reads as water rather than as vertical stripes.
        const stepWorld = 7 / (focal * 1.15 * scale);
        const halfW = w * 0.62 / (focal * 1.15 * scale);
        for (let wx = -halfW + (r % 2) * stepWorld * 0.5; wx <= halfW; wx += stepWorld) {
          const wave =
            Math.sin(wx * 0.42 + dz * 0.62 + t * 0.42) * 0.5 +
            Math.sin(wx * 0.83 - dz * 1.1 + t * 0.27) * 0.32 +
            Math.sin(dz * 1.7 + wx * 0.19 + t * 0.16) * 0.2;
          const x = w / 2 + wx * scale * focal * 1.15;
          const y = sy - wave * scale * focal * 0.5;
          const crest = Math.max(0, wave * 0.5 + 0.5);
          // Dots are the medium, not the fill: peak alpha stays under a third so
          // the ridges read as ridges and the water between them stays dark.
          const light = (0.04 + 0.24 * crest) * fog;
          if (light < 0.012) continue;
          const size = 0.9 + 1.5 * (1 - Math.min(1, dz / 16));
          const rr = Math.round(112 + crest * 58);
          const gg = Math.round(96 + crest * 54);
          const bb = Math.round(190 + crest * 60);
          ctx.fillStyle = `rgba(${rr},${gg},${bb},${light.toFixed(3)})`;
          ctx.fillRect(x, y, size, size);
        }
      }

      // Graph. The reference is a 262 px ring on a 1512 px stage, with a
      // wireframe hub at its centre and four compass labels on the rim.
      const R = Math.min(w * 0.172, h * 0.37) * v.zoom;
      const cx = w / 2 + v.panX;
      const cy = h * 0.394 + v.panY;

      // Ring — one solid circle, one dashed ellipse turned off-axis, and the
      // faint radial wash the hub sits in.
      const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.46);
      hub.addColorStop(0, "rgba(120,88,255,0.20)");
      hub.addColorStop(0.55, "rgba(96,70,220,0.07)");
      hub.addColorStop(1, "rgba(80,60,200,0)");
      ctx.fillStyle = hub;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.46, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(150,140,230,0.30)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.32);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = "rgba(150,140,230,0.20)";
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.79, R * 0.56, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = "rgba(150,140,230,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.99, R * 0.99, 0, -0.9, 0.75);
      ctx.stroke();
      ctx.restore();

      // Hub: a wireframe sphere of meridians, as the reference hangs at centre.
      const hr = Math.min(42, R * 0.175) * (0.98 + Math.sin(t * 0.9) * 0.02);
      ctx.strokeStyle = "rgba(203,194,255,0.3)";
      ctx.lineWidth = 0.65;
      for (let i = 0; i < 6; i++) {
        const a = v.yaw * 0.6 + (i / 6) * Math.PI;
        const squash = Math.abs(Math.cos(a));
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(0.6, hr * squash), hr, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 1; i <= 3; i++) {
        const y = cy - hr + (i / 4) * hr * 2;
        const rad = Math.sqrt(Math.max(0, hr * hr - (y - cy) * (y - cy)));
        ctx.beginPath();
        ctx.ellipse(cx, y, rad, Math.max(1.2, rad * 0.24), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const cosY = Math.cos(v.yaw);
      const sinY = Math.sin(v.yaw);
      const cosX = Math.cos(v.pitch);
      const sinX = Math.sin(v.pitch);

      const project = (n: Node) => {
        const x1 = n.x * cosY - n.z * sinY;
        const z1 = n.x * sinY + n.z * cosY;
        const y1 = n.y * cosX - z1 * sinX;
        const z2 = n.y * sinX + z1 * cosX;
        const persp = 1 / (1 - z2 * 0.28);
        // Keep the constellation inside the rim: the reference names its four
        // kinds *around* the circle, so nodes and their labels must not wander
        // out under those names.
        return { sx: cx + x1 * R * persp * 0.84, sy: cy + y1 * R * persp * 0.84, depth: z2, scale: persp };
      };

      const byId = new Map(shown.map((n) => [n.id, n]));
      for (const e of all.edges) {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        if (!a || !b) continue;
        const pa = project(a);
        const pb = project(b);
        if (!matched.has(a.id) || !matched.has(b.id)) continue;
        const depth = (pa.depth + pb.depth) / 2;
        // A link that touches the selected record is drawn in its colour, so
        // "what is this connected to" is readable without reading labels.
        const lit = m.selected !== null && (e.a === m.selected || e.b === m.selected);
        const alpha = (lit ? 0.55 : 0.10) + Math.max(0, depth + 1) * (lit ? 0.25 : 0.14);
        ctx.strokeStyle = lit ? `${KIND_COLOR[byId.get(m.selected ?? e.a)?.kind ?? "memory"]}cc` : `rgba(214,208,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = lit ? 1.3 : 0.85;
        ctx.beginPath();
        // Long links bow outward, which is what makes the reference read as a
        // constellation rather than a spider web.
        const dist = Math.hypot(pb.sx - pa.sx, pb.sy - pa.sy);
        let ctrlX = (pa.sx + pb.sx) / 2;
        let ctrlY = (pa.sy + pb.sy) / 2;
        if (dist > R * 0.55) {
          const ox = ctrlX - cx;
          const oy = ctrlY - cy;
          const len = Math.hypot(ox, oy) || 1;
          ctrlX += (ox / len) * dist * 0.16;
          ctrlY += (oy / len) * dist * 0.16;
          ctx.moveTo(pa.sx, pa.sy);
          ctx.quadraticCurveTo(ctrlX, ctrlY, pb.sx, pb.sy);
        } else {
          ctx.moveTo(pa.sx, pa.sy);
          ctx.lineTo(pb.sx, pb.sy);
        }
        ctx.stroke();

        // A single spark runs each link on a slow, per-link offset, so the
        // constellation is visibly *moving* even when the camera is still.
        if (!reduced) {
          const u = (t * 0.09 + hash(e.a + e.b)) % 1;
          const iu = 1 - u;
          const px = iu * iu * pa.sx + 2 * iu * u * ctrlX + u * u * pb.sx;
          const py = iu * iu * pa.sy + 2 * iu * u * ctrlY + u * u * pb.sy;
          const fadeIn = Math.sin(u * Math.PI);
          ctx.fillStyle = `rgba(232,228,255,${(alpha * 3.4 * fadeIn).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, lit ? 2 : 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const ordered = [...shown].sort((a, b) => project(a).depth - project(b).depth);
      for (const n of ordered) {
        const p = project(n);
        const fade = 0.42 + Math.max(0, (p.depth + 1) / 2) * 0.58;
        const isSel = m.selected === n.id;
        // A slow breath, offset per node, so the constellation is alive without
        // anything that could be mistaken for a loading state.
        const breath = 1 + Math.sin(t * 1.35 + hash(n.id) * 6.28) * 0.07;
        const r = (3 + Math.min(2.4, n.degree * 0.35)) * p.scale * (isSel ? 1.5 : 1) * breath;
        const color = KIND_COLOR[n.kind];

        ctx.globalAlpha = fade;
        const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 3.6);
        glow.addColorStop(0, `${color}aa`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 3.6, 0, Math.PI * 2);
        ctx.fill();

        // Three marks, as the reference uses: a dot for records, an open ring
        // for topics and a turned square for knowledge.
        if (n.kind === "topic") {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, Math.max(2.6, r), 0, Math.PI * 2);
          ctx.stroke();
        } else if (n.kind === "knowledge") {
          const s2 = Math.max(2.6, r) * 0.95;
          ctx.save();
          ctx.translate(p.sx, p.sy);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = color;
          ctx.fillRect(-s2, -s2, s2 * 2, s2 * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, Math.max(1.6, r), 0, Math.PI * 2);
          ctx.fill();
        }

        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r + 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        const showLabel = m.labels && (isSel || n.degree >= 1 || n.kind === "memory" || n.kind === "knowledge");
        if (showLabel) {
          // Their `.node-label`: 12 px/500, 3×7 padding, 5 px radius, #040a1290
          // behind it, 13 px at the hub and 14 px/600 when selected.
          const fs = isSel ? 14 : n.kind === "topic" || n.degree > 3 ? 13 : 12;
          ctx.globalAlpha = Math.min(1, fade + 0.2);
          ctx.font = `${isSel ? 600 : 500} ${fs}px "Inter", "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = "center";
          const label = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
          const tw = ctx.measureText(label).width;
          const chipW = tw + 14;
          const chipH = fs + 8;
          const chipY = p.sy - r - 10 - chipH;
          ctx.fillStyle = "rgba(4,10,18,0.56)";
          ctx.beginPath();
          ctx.roundRect(p.sx - chipW / 2, chipY, chipW, chipH, 5);
          ctx.fill();
          ctx.fillStyle = isSel ? "#ffffff" : "rgba(255,255,255,0.92)";
          ctx.fillText(label, p.sx, chipY + chipH / 2 + fs * 0.36);
        }
        ctx.globalAlpha = 1;
      }

      // Compass labels on the rim: the four things she keeps, named where the
      // reference names them.
      // Positions lifted from the reference's own frame, in units of the ring
      // radius: TOPICS sits high and left outside the rim, MEMORIES out to the
      // right, CONVERSATIONS off to the left and KNOWLEDGE just inside the foot.
      const compass: { text: string; dx: number; dy: number; color: string }[] = [
        { text: "TOPICS", dx: -1.24, dy: -0.44, color: KIND_COLOR.topic },
        { text: "MEMORIES", dx: 1.14, dy: -0.02, color: KIND_COLOR.memory },
        { text: "CONVERSATIONS", dx: -1.28, dy: 0.46, color: "rgba(255,255,255,0.66)" },
        { text: "KNOWLEDGE", dx: 1.06, dy: 0.62, color: KIND_COLOR.knowledge },
      ];
      // `.brain-compass-mark`: 600 10 px mono at 0.14 em, with the hard black
      // text shadow that keeps it readable over the sea. Their marks are pushed
      // radially out of the node's label, so they sit clear of the graph; ours
      // are clamped out of the filter rail and the toolbar for the same reason.
      ctx.font = '600 10px "JetBrains Mono", "SFMono-Regular", Menlo, monospace';
      ctx.letterSpacing = "1.4px";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 5;
      ctx.textAlign = "left";
      const railEdge = 350;
      const stageRight = w - 34;
      for (const c of compass) {
        const wLabel = ctx.measureText(c.text).width;
        let x = cx + c.dx * R;
        let y = cy + c.dy * R;
        // A mark that would land on a node's label is nudged outward instead.
        for (const n of shown) {
          const p = project(n);
          if (Math.hypot(p.sx - x, p.sy - y) < 74) {
            x = cx + c.dx * R * 1.1;
            y = cy + c.dy * R * 1.1;
            break;
          }
        }
        x = Math.max(railEdge, Math.min(stageRight - wLabel, x));
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.82;
        ctx.fillText(c.text, x, y);
        ctx.globalAlpha = 1;
      }
      ctx.letterSpacing = "0px";
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [shown, all.edges, matched]);

  useEffect(() => {
    setSpin(0);
    const id = window.setInterval(() => setSpin((s) => (s + 1) % 3), 4200);
    return () => window.clearInterval(id);
  }, []);

  /* ---- pointer --------------------------------------------------------- */

  const hit = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = ref.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const v = view.current;
      const R = Math.min(rect.width * 0.172, rect.height * 0.37) * v.zoom;
      const cx = rect.width / 2 + v.panX;
      const cy = rect.height * 0.394 + v.panY;
      let best: { id: string; d: number } | null = null;
      for (const n of shown) {
        const x1 = n.x * Math.cos(v.yaw) - n.z * Math.sin(v.yaw);
        const z1 = n.x * Math.sin(v.yaw) + n.z * Math.cos(v.yaw);
        const y1 = n.y * Math.cos(v.pitch) - z1 * Math.sin(v.pitch);
        const persp = 1 / (1 - (n.y * Math.sin(v.pitch) + z1 * Math.cos(v.pitch)) * 0.28);
        const sx = cx + x1 * R * persp * 0.84;
        const sy = cy + y1 * R * persp * 0.84;
        const d = Math.hypot(sx - px, sy - py);
        if (d < 18 && (!best || d < best.d)) best = { id: n.id, d };
      }
      return best?.id ?? null;
    },
    [shown],
  );

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      // Their hover label: a fixed tooltip 14 px off the pointer, with the
      // record's name over its kind and degree.
      const id = hit(e.clientX, e.clientY);
      const box = ref.current?.getBoundingClientRect();
      setHover(id && box ? { id, x: e.clientX - box.left, y: e.clientY - box.top } : null);
      return;
    }
    setHover(null);
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    if (d.kind === "pan") {
      view.current.panX += dx;
      view.current.panY += dy;
    } else {
      view.current.yaw += dx * 0.006;
      view.current.pitch = Math.max(-1.15, Math.min(1.15, view.current.pitch + dy * 0.005));
      view.current.vYaw = Math.max(-7, Math.min(7, dx * 0.38));
      view.current.vPitch = Math.max(-3, Math.min(3, dy * 0.3));
    }
  };

  const zoomBy = (factor: number) => {
    setZoom((z) => {
      const next = Math.max(0.5, Math.min(2.6, z * factor));
      view.current.zoom = next;
      return next;
    });
  };

  const resetView = () => {      view.current = { yaw: 0.5, pitch: -0.2, panX: 0, panY: 0, zoom: 1, resume: 0, vYaw: 0, vPitch: 0 };
    setZoom(1);
    setSelected(null);
  };

  const selectedNode = selected ? all.nodes.find((n) => n.id === selected) ?? null : null;


  const applyPreset = (p: Preset) => {
    const now = Date.now();
    setPreset(p);
    // "All" means the whole record, not a decade of empty time: the brush should
    // frame what is actually kept, which is what the reference's dates show.
    const oldest = all.nodes.reduce((min, n) => Math.min(min, n.at), now);
    setRange([p === "All" ? oldest : now - PRESET_MS[p], now]);
  };

  const toggleKind = (k: Kind) =>
    setHidden((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const chips: { kind: Kind; label: string; icon?: "dash" | "ring" }[] = [
    { kind: "memory", label: "Memories" },
    { kind: "topic", label: "Topics", icon: "ring" },
    { kind: "conversation", label: "Conversations", icon: "dash" },
    { kind: "knowledge", label: "Knowledge" },
  ];

  return (
    <div className="brain">
      <canvas
        ref={ref}
        className="brain-canvas"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          // Shift-drag pans, plain drag orbits — the reference's two gestures.
          drag.current = { x: e.clientX, y: e.clientY, kind: e.shiftKey || mode === "pan" ? "pan" : "orbit" };
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          const moved = drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 3;
          drag.current = null;
          if (!moved) {
            const id = hit(e.clientX, e.clientY);
            if (id) setSelected(id);
            else setSelected(null);
          }
        }}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          // Plain arrows belong to the app: they step between screens, so the
          // brain is reachable from the keyboard. Panning keeps Shift + arrow,
          // which is how the reference's manipulator disambiguates the two.
          const pan = 40;
          if (!e.shiftKey && /^Arrow/.test(e.key)) return;
          if (e.key === "ArrowLeft") view.current.panX -= pan;
          else if (e.key === "ArrowRight") view.current.panX += pan;
          else if (e.key === "ArrowUp") view.current.panY -= pan;
          else if (e.key === "ArrowDown") view.current.panY += pan;
          else if (e.key === "+" || e.key === "=") zoomBy(1.15);
          else if (e.key === "-") zoomBy(1 / 1.15);
          else if (e.key.toLowerCase() === "r") resetView();
          else return;
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
          zoomBy(e.deltaY < 0 ? 1.08 : 0.926);
        }}
        role="img"
        aria-label={`Knowledge graph: ${counts.memory} memories, ${counts.topic} topics, ${counts.conversation} conversations, ${counts.knowledge} knowledge records`}
      />

      {hover &&
        (() => {
          const n = all.nodes.find((item) => item.id === hover.id);
          if (!n) return null;
          return (
            <div className="brain-hover" style={{ left: hover.x, top: hover.y }} role="tooltip">
              <b>{n.label.length > 60 ? `${n.label.slice(0, 59)}…` : n.label}</b>
              <span>
                {KIND_LABEL[n.kind]} · {n.degree} link{n.degree === 1 ? "" : "s"} · {fmt(n.at)}
              </span>
            </div>
          );
        })()}

      <aside className="brain-panel">
        <label className="brain-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memory"
            aria-label="Search memory"
          />
          {query && (
            <button className="brain-clear" onClick={() => setQuery("")} aria-label="Clear search">
              <Icon name="close" size={11} />
            </button>
          )}
        </label>

        <button className="brain-filters" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
          <Icon name={filtersOpen ? "down" : "right"} size={14} />
          <Icon name="sliders" size={14} />
          <span>Filters</span>
        </button>

        {filtersOpen && (
          <div className="brain-filters-body">
            <p className="brain-label">What's stored</p>
            <div className="brain-chips">
              {chips.map((c) => (
                <button
                  key={c.kind}
                  className={`brain-chip ${hidden.includes(c.kind) ? "off" : "on"}`}
                  onClick={() => toggleKind(c.kind)}
                  aria-pressed={!hidden.includes(c.kind)}
                >
                  <i
                    className={c.icon === "dash" ? "brain-chip-dash" : c.icon === "ring" ? "brain-chip-ring" : "brain-chip-dot"}
                    style={{ color: KIND_COLOR[c.kind] }}
                  />
                  <span>{c.label}</span>
                  <b>{counts[c.kind]}</b>
                </button>
              ))}
            </div>

            <p className="brain-label">When</p>
            <div
              className="brain-brush"
              onPointerDown={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
                const at = range[0] + (range[1] - range[0]) * f;
                const mid = (range[0] + range[1]) / 2;
                setPreset("All");
                setRange(at < mid ? [at, range[1]] : [range[0], at]);
                setPreset("All");
              }}
            >
              <div className="brain-brush-bars" aria-hidden>
                {buckets.map((v, i) => (
                  <span key={i} style={{ height: `${Math.max(8, v * 100)}%`, opacity: 0.28 + v * 0.6 }} />
                ))}
              </div>
              <span className="brain-brush-handle" data-side="l" />
              <span className="brain-brush-handle" data-side="r" />
            </div>
            <div className="brain-when-row">
              <span className="brain-when-date">
                {dateLines[0]} –<br />
                {dateLines[1]}
              </span>
              <div className="brain-presets" role="group" aria-label="Time range">
                {PRESETS.map((p) => (
                  <button key={p} className={preset === p ? "on" : ""} onClick={() => applyPreset(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <p className="brain-label">About</p>
            <div className="brain-about">
              {about.length === 0 && <p className="brain-empty">Nothing kept yet.</p>}
              {(showAllTopics ? about : about.slice(0, 4)).map((n) => (
                <button
                  key={n.id}
                  className={`brain-about-row ${selected === n.id ? "on" : ""}`}
                  onClick={() => setSelected(n.id)}
                >
                  <i style={{ color: KIND_COLOR.topic }} />
                  <span>{n.label}</span>
                  <b>{n.degree}</b>
                </button>
              ))}
              {about.length > 4 && (
                <button className="brain-see-all" onClick={() => setShowAllTopics((v) => !v)}>
                  {showAllTopics ? "Show less" : "See all"}
                </button>
              )}
            </div>

            <button className="brain-explorer" onClick={() => openFileViewer()}>
              <span>File Explorer</span>
              <b>{db.docs.length}</b>
              <Icon name="clock" size={14} />
              <Icon name="folder" size={14} />
            </button>
            <button className="brain-file-row" onClick={onOpenDocuments}>
              <Icon name="doc" size={14} />
              <span>Documents</span>
              <b>{db.docs.length}</b>
              <Icon name="right" size={13} />
            </button>
          </div>
        )}

        <label className="brain-composer">
          <input placeholder="Tell her something" aria-label="Tell her something" />
          <Icon name="send" size={13} />
        </label>
      </aside>

      <div className="brain-stage">
        <div className="brain-toolbar" role="toolbar" aria-label="Graph controls">
          <button className={mode === "rotate" ? "on" : ""} onClick={() => setMode("rotate")}>
            Rotate
          </button>
          <button className={mode === "pan" ? "on" : ""} onClick={() => setMode("pan")}>
            Pan
          </button>
          <span className="brain-toolbar-sep" />
          <button onClick={() => zoomBy(0.87)} aria-label="Zoom out">
            −
          </button>
          <span className="brain-zoom">{Math.round(zoom * 100)}%</span>
          <button onClick={() => zoomBy(1.15)} aria-label="Zoom in">
            +
          </button>
          <span className="brain-toolbar-sep" />
          <button onClick={resetView}>Reset view</button>
          <span className="brain-toolbar-sep" />
          <button className={orbit ? "" : "off"} onClick={() => setOrbit((v) => !v)} aria-pressed={orbit}>
            <Icon name="pause" size={12} />
            Motion
          </button>
          <button onClick={() => setLabels((v) => !v)} aria-pressed={labels}>
            <Icon name="tag" size={12} />
            All labels
          </button>
        </div>

        <p className="brain-hint">Drag to orbit · Scroll to zoom · Click anything</p>

        {selectedNode && (
          <div className="brain-detail">
            <span className="brain-detail-kind" style={{ color: KIND_COLOR[selectedNode.kind] }}>
              {KIND_LABEL[selectedNode.kind]}
            </span>
            <p>{selectedNode.text}</p>
            <span className="brain-detail-at">{fmt(selectedNode.at)}</span>
            <button className="icon-btn sm" onClick={() => setSelected(null)} aria-label="Close">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        {/* Edge pagers: the same slide the world's companion arrows use, so a
            person who has learned one can page the screens with the other. */}
        <button
          className="brain-step prev"
          onClick={onPrev ?? onWorld}
          aria-label="Previous screen"
          title="Previous screen"
        >
          <Icon name="left" size={18} />
        </button>
        <button
          className="brain-step next"
          onClick={onNext ?? onWorld}
          aria-label="Next screen"
          title="Next screen"
        >
          <Icon name="right" size={18} />
        </button>

        <div className="brain-heading">
          <h1>BRAIN</h1>
          <p>HER MEMORY · EVERYTHING SHE KEEPS FOR YOU</p>
        </div>

        <div className="brain-switch">
          <button onClick={onPrev ?? onWorld} aria-label="Previous screen">
            <Icon name="left" size={16} />
          </button>
          <button onClick={onNext ?? onWorld} aria-label="Next screen">
            <Icon name="right" size={16} />
          </button>
        </div>
        <div className="brain-dots">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <button
              key={i}
              className={i === page ? "on" : ""}
              onClick={() => onGo?.(i)}
              aria-label={`View ${i + 1}`}
            />
          ))}
        </div>
      </div>

      <span className="brain-count" key={spin}>
        {shown.length} in view
      </span>
    </div>
  );
}
