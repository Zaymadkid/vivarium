import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * The brand mark and the per-destination logos.
 *
 * The mark is drawn, not imported: three orbital arcs around a lit core, on the
 * same 22 px grid as the icon set. It moves — the outer ring turns once every
 * 24 s, the middle ring counter-turns every 16 s, and the core breathes on the
 * world's 4 s cycle — so the wordmark is never a static image.
 *
 * `ItemLogo` is the other half: every destination, integration, marketplace item
 * and companion gets a deterministic tile (hue from its id) with a glyph. Same
 * input, same tile, so a thing is recognisable everywhere it appears.
 */

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brandmark-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id="bm-core" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="bm-core" cx="12" cy="12" r="6.2" fill="url(#bm-core)" />
      <g className="bm-ring bm-ring-a" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round">
        <path d="M12 2.4a9.6 9.6 0 0 1 8.3 4.8" opacity="0.9" />
        <path d="M12 21.6a9.6 9.6 0 0 1-8.3-4.8" opacity="0.9" />
      </g>
      <g className="bm-ring bm-ring-b" stroke="currentColor" strokeWidth="0.9" fill="none" strokeLinecap="round">
        <path d="M3.2 10.4A9 9 0 0 1 12 3" opacity="0.55" />
        <path d="M20.8 13.6A9 9 0 0 1 12 21" opacity="0.55" />
      </g>
      <g className="bm-orbit">
        <circle cx="12" cy="3.1" r="1.15" fill="currentColor" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** Stable hue for a named thing: same word, same colour, everywhere. */
export function logoHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  return hash;
}

const glyphs: Record<string, IconName> = {
  world: "target",
  console: "bolt",
  configure: "gear",
  chat: "spark",
  documents: "doc",
  skills: "skill",
  integrations: "plug",
  automations: "clock",
  portals: "users",
  marketplace: "box",
  credits: "credit",
  settings: "gear",
  dashboard: "grid",
  calendar: "clock",
  team: "users",
  tools: "cpu",
  comms: "wave",
  contacts: "user",
};

export function ItemLogo({
  id,
  label,
  size = 20,
  glyph,
  icon,
  className,
}: {
  id: string;
  label: string;
  size?: number;
  glyph?: IconName;
  icon?: ReactNode;
  className?: string;
}) {
  const hue = logoHue(id);
  const style = {
    "--logo-hue": `${hue}`,
    width: size,
    height: size,
    borderRadius: Math.max(4, Math.round(size * 0.24)),
  } as CSSProperties;

  return (
    <span className={`item-logo ${className ?? ""}`} style={style} title={label} aria-hidden>
      {icon ?? <Icon name={glyph ?? glyphs[id] ?? "box"} size={Math.round(size * 0.62)} />}
    </span>
  );
}

/** The wordmark: mark + letters + ™. The mark moves, the letters glow. */
export function Wordmark({ suffix = "_OS", tm = true }: { suffix?: string; tm?: boolean }) {
  return (
    <>
      <BrandMark size={19} />
      <span className="brandmark">
        VIVARIUM<span className="brandmark-suffix">{suffix}</span>
      </span>
      {tm && <span className="brandmark-tm">™</span>}
    </>
  );
}
