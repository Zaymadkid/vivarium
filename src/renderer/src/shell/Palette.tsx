import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface PaletteRow {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  hint?: string;
  run: () => void;
}

export function Palette({
  rows,
  onClose,
}: {
  rows: PaletteRow[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.label} ${r.group}`.toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(filtered.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = filtered[index];
        if (row) {
          row.run();
          onClose();
        }
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, index, onClose]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const groups = useMemo(() => {
    const map = new Map<string, { row: PaletteRow; i: number }[]>();
    filtered.forEach((row, i) => {
      const list = map.get(row.group) ?? [];
      list.push({ row, i });
      map.set(row.group, list);
    });
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal aria-label="Jump to">
        <div className="palette-input">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={query}
            placeholder="Jump to a companion or view..."
            aria-label="Jump to a companion or view"
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="palette-none">No matches — try a companion name or a destination.</div>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="palette-group">
              <span className="palette-group-label">{group}</span>
              {items.map(({ row, i }) => (
                <button
                  key={row.id}
                  data-index={i}
                  className={`palette-row ${i === index ? "on" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    row.run();
                    onClose();
                  }}
                >
                  <span className="palette-icon">
                    <Icon name={row.icon} size={14} />
                  </span>
                  <span className="palette-label">{row.label}</span>
                  {row.hint && <span className="palette-hint">{row.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">Enter</kbd> open
          </span>
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> move
          </span>
          <span>
            <kbd className="kbd">Escape</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
