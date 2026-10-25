import { useLayoutEffect, useRef, useState } from "react";

/**
 * Tabs — the reference's tab row.
 *
 * Literal values from the shipped chunks (`PortalsView-KDBw-oDO.js`,
 * `IntegrationsView-DdBSzhu1.js`, `ChatPanel-C2wai6dz.js`):
 *
 *   className="relative px-3 py-2 text-[10px] font-bold uppercase tracking-wider
 *              transition-all duration-200 whitespace-nowrap shrink-0"
 *   style={{ color: active ? "#FF6D00" : muted,
 *            background: active ? "rgba(255,255,255,0.04)" : "transparent" }}
 *   {active && <m.div layoutId="…” className="absolute bottom-0 left-0 right-0 h-[2px]"
 *              style={{ background: "#FF6D00" }}
 *              transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
 *
 * The underline is one shared element that slides between tabs, so it is measured
 * from the active button rather than drawn per tab. Stiffness 500 / damping 35 is
 * ζ ≈ 0.78 — a fast settle with a hint of overshoot, which is what the cubic
 * bezier below approximates in CSS.
 */
export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  align = "start",
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  items: TabItem<T>[];
  align?: "start" | "stretch";
  label: string;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const [line, setLine] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const host = row.current;
    if (!host) return;
    const active = host.querySelector<HTMLButtonElement>(`[data-value="${value}"]`);
    if (!active) return;
    setLine({ left: active.offsetLeft, width: active.offsetWidth });

    const observer = new ResizeObserver(() => {
      setLine({ left: active.offsetLeft, width: active.offsetWidth });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [value, items.length]);

  return (
    <div
      className={`tabs ${align === "stretch" ? "stretch" : ""}`}
      role="tablist"
      aria-label={label}
      ref={row}
    >
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={on}
            data-value={item.value}
            className={`tab ${on ? "on" : ""}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
            {item.count != null && <span className="tab-count">{item.count}</span>}
          </button>
        );
      })}
      <span
        className="tab-line"
        aria-hidden
        style={{ transform: `translateX(${line.left}px)`, width: `${line.width}px` }}
      />
    </div>
  );
}
