import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DiagramSpec } from "../../../shared/types";
import { layoutDiagram } from "./diagram-model";
import { Icon } from "./icons";

/**
 * An answer drawn as a map.
 *
 * The model supplies structure, this component supplies the geometry and the
 * interaction: drag to pan, wheel or buttons to zoom, click a node for its
 * detail and a one-click follow-up. Nothing here is fixed to a particular
 * diagram, so every answer can assemble its own.
 */

interface Props {
  spec: DiagramSpec;
  /** Seed the composer with a question about one node. */
  onAsk?: (question: string) => void;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

export function Diagram({ spec, onAsk }: Props) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [compact, setCompact] = useState(false);
  const drag = useRef({ x: 0, y: 0, vx: 0, vy: 0, moved: 0 });
  // A wide left-to-right flow is unreadable in a 355 px chat column. Stack it
  // top-to-bottom there, and restore the authored direction in the full view.
  const layout = useMemo(
    () => layoutDiagram(compact && spec.direction !== "tb" ? { ...spec, direction: "tb" } : spec),
    [spec, compact],
  );

  const fit = useCallback(() => {
    const box = frame.current;
    if (!box) return;
    const width = box.clientWidth || 720;
    const height = box.clientHeight || 360;
    const scale = Math.min(1.15, Math.max(0.3, Math.min((width - 16) / layout.width, (height - 16) / layout.height)));
    setView({
      x: (width - layout.width * scale) / 2,
      y: (height - layout.height * scale) / 2,
      scale,
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const measure = () => setCompact(box.clientWidth < 560);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    fit();
  }, [fit, spec, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const next = Math.min(2.4, Math.max(0.25, current.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
        const ratio = next / current.scale;
        return { scale: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (factor: number) => {
    const box = frame.current;
    const px = (box?.clientWidth ?? 720) / 2;
    const py = (box?.clientHeight ?? 360) / 2;
    setView((current) => {
      const next = Math.min(2.4, Math.max(0.25, current.scale * factor));
      const ratio = next / current.scale;
      return { scale: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  };

  const node = layout.nodes.find((entry) => entry.id === selected);
  const links = node
    ? {
        out: spec.edges.filter((edge) => edge.from === node.id),
        in: spec.edges.filter((edge) => edge.to === node.id),
      }
    : null;
  const labelOf = (id: string) => layout.nodes.find((entry) => entry.id === id)?.label ?? id;

  const body = (
    <figure className={`diagram${expanded ? " expanded" : ""}`}>
      <header className="diagram-head">
        <span className="diagram-title">
          <Icon name="board" size={12} />
          {spec.title || "Diagram"}
        </span>
        <span className="diagram-tools">
          <button type="button" className="icon-btn sm" onClick={() => zoom(1.18)} title="Zoom in" aria-label="Zoom in">
            <Icon name="plus" size={12} />
          </button>
          <button type="button" className="icon-btn sm" onClick={() => zoom(0.85)} title="Zoom out" aria-label="Zoom out">
            <Icon name="minus" size={12} />
          </button>
          <button type="button" className="icon-btn sm" onClick={fit} title="Fit diagram" aria-label="Fit diagram">
            <Icon name="target" size={12} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? "Close full view" : "Open full view"}
            aria-label={expanded ? "Close full view" : "Expand diagram"}
          >
            <Icon name={expanded ? "close" : "external"} size={12} />
          </button>
        </span>
      </header>

      <div
        ref={frame}
        className={`diagram-frame${dragging ? " dragging" : ""}`}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".diagram-node, .diagram-detail, button")) return;
          drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: 0 };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelected(null);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current.moved = Math.abs(dx) + Math.abs(dy);
          setView((current) => ({ ...current, x: drag.current.vx + dx, y: drag.current.vy + dy }));
        }}
        onPointerUp={(event) => {
          setDragging(false);
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* capture already gone */
          }
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <svg
          className="diagram-svg"
          viewBox={`0 0 ${frame.current?.clientWidth || 720} ${frame.current?.clientHeight || 360}`}
          role="img"
          aria-label={spec.title || "Interactive diagram"}
        >
          <defs>
            <marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" className="diagram-arrowhead" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {layout.edges.map(({ edge, path }, index) => {
              const from = layout.nodes.find((entry) => entry.id === edge.from);
              const to = layout.nodes.find((entry) => entry.id === edge.to);
              const midX = from && to ? (from.x + from.w / 2 + to.x + to.w / 2) / 2 : 0;
              const midY = from && to ? (from.y + from.h / 2 + to.y + to.h / 2) / 2 : 0;
              return (
                <g key={`${edge.from}-${edge.to}-${index}`} className={`diagram-edge${edge.dashed ? " dashed" : ""}`}>
                  <path d={path} markerEnd="url(#diagram-arrow)" />
                  {edge.label && (
                    <text x={midX} y={midY - 6} textAnchor="middle" className="diagram-edge-label">
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {layout.nodes.map((entry) => (
              <g
                key={entry.id}
                className={`diagram-node ${entry.kind ?? "step"}${selected === entry.id ? " selected" : ""}`}
                transform={`translate(${entry.x} ${entry.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${entry.label}${entry.detail ? `. ${entry.detail}` : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected((current) => (current === entry.id ? null : entry.id));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected((current) => (current === entry.id ? null : entry.id));
                  }
                }}
              >
                <rect width={entry.w} height={entry.h} rx={12} />
                <foreignObject x={12} y={8} width={entry.w - 24} height={entry.h - 16}>
                  <div className="diagram-node-label">{entry.label}</div>
                </foreignObject>
                {entry.kind && entry.kind !== "step" && <text x={entry.w - 10} y={14} textAnchor="end" className="diagram-kind">{entry.kind}</text>}
              </g>
            ))}
          </g>
        </svg>

        {node && links && (
          <aside className="diagram-detail" aria-label={`Detail for ${node.label}`}>
            <header>
              <span className={`cchip ${node.kind === "warning" || node.kind === "decision" ? "exec" : "read"}`}>
                {node.kind ?? "step"}
              </span>
              <strong>{node.label}</strong>
              <button type="button" className="icon-btn sm" onClick={() => setSelected(null)} aria-label="Close node detail">
                <Icon name="close" size={11} />
              </button>
            </header>
            <p>{node.detail || "No extra detail for this step. Ask her about it."}</p>
            {links.in.length > 0 && (
              <p className="diagram-linkrow">
                <span>From</span> {links.in.map((edge) => labelOf(edge.from)).join(", ")}
              </p>
            )}
            {links.out.length > 0 && (
              <p className="diagram-linkrow">
                <span>To</span> {links.out.map((edge) => labelOf(edge.to)).join(", ")}
              </p>
            )}
            {onAsk && (
              <button
                type="button"
                className="btn sm"
                onClick={() => onAsk(`In the diagram “${spec.title || node.label}”, explain “${node.label}” in more detail.`)}
              >
                <Icon name="spark" size={11} />
                Ask about this
              </button>
            )}
          </aside>
        )}
      </div>

      <figcaption>
        <span>Drag to pan · scroll to zoom · click a node · expand for the full view</span>
        <span className="diagram-count">
          {spec.nodes.length} node{spec.nodes.length === 1 ? "" : "s"}
        </span>
      </figcaption>
    </figure>
  );
  // The drawer's own transform would make `position: fixed` relative to the
  // drawer, so the full view is mounted on the body instead.
  return expanded ? createPortal(body, document.body) : body;
}
