import { useMemo } from "react";
import type { AgentRecord } from "../../../shared/types";

/**
 * THE SWARM — her other companions, standing around her.
 *
 * The reference stages workers on a tilted ring around the main orb, each one
 * a small ember with its name under it, and a newborn arrives along a curved
 * particle thread (`SwarmStage`): the child grows at 0.6 progress a second,
 * the delivery cone fades at 0.35/s after 40 %, and the name fades a letter
 * at a time, 120 ms each staggered 24 ms.
 *
 * This overlay is DOM, not a second WebGL scene: the main orb already owns the
 * camera, and a handful of companions do not justify another context.
 */

const TAU = Math.PI * 2;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function Swarm({
  agents,
  activeId,
  bornId,
  onSelect,
}: {
  agents: AgentRecord[];
  activeId?: string;
  bornId?: string | null;
  onSelect: (id: string) => void;
}) {
  const ring = useMemo(() => {
    const others = agents.filter((a) => a.id !== activeId);
    // Seven fixed seats, filled in arrival order: adding one companion must not
    // shuffle the ones already standing there.
    return others.map((a, i) => {
      const angle = (i / 7) * TAU - Math.PI / 2 + hash(a.id) * 0.18;
      return {
        agent: a,
        // Percent of the stage: a wide, shallow ellipse in the sea's plane.
        x: 50 + Math.cos(angle) * 27,
        y: 40 + Math.sin(angle) * 15,
        hue: a.hue,
      };
    });
  }, [agents, activeId]);

  const born = ring.find((r) => r.agent.id === bornId);

  return (
    <div className="swarm" aria-label="Companions">
      {born && (() => {
        // The delivery: a widening cone of light from her seat to the newborn's,
        // a thread inside it, and a dozen embers riding the same curve. The
        // reference calls this a delivery cone; this is ours, in SVG, so it
        // lands on the world without a second WebGL context.
        const cx = (50 + born.x) / 2 + 4;
        const cy = (40 + born.y) / 2 - 8;
        const path = `M50 40 Q ${cx} ${cy}, ${born.x} ${born.y}`;
        const dx = born.x - 50;
        const dy = born.y - 40;
        const length = Math.hypot(dx, dy) || 1;
        const nx = (-dy / length) * 2.4;
        const ny = (dx / length) * 2.4;
        return (
          <svg className="swarm-thread" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="swarmGrad" x1="50" y1="40" x2={born.x} y2={born.y} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={`hsl(${born.hue} 90% 62%)`} stopOpacity="0.9" />
                <stop offset="0.7" stopColor={`hsl(${born.hue} 95% 70%)`} stopOpacity="0.7" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id="swarmCone" x1="50" y1="40" x2={born.x} y2={born.y} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={`hsl(${born.hue} 90% 62%)`} stopOpacity="0" />
                <stop offset="0.55" stopColor={`hsl(${born.hue} 95% 68%)`} stopOpacity="0.22" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
              </linearGradient>
            </defs>

            <polygon
              className="swarm-cone"
              points={`50,40 ${born.x + nx},${born.y + ny} ${born.x - nx},${born.y - ny}`}
              fill="url(#swarmCone)"
            />

            <path d={path} pathLength="1" fill="none" stroke="url(#swarmGrad)" strokeWidth="0.18" strokeLinecap="round" />

            {/* Embers: speed uneven on purpose, so the delivery looks alive. */}
            {Array.from({ length: 16 }, (_, i) => (
              <circle
                key={i}
                className="swarm-ember"
                r={0.18 + ((i * 7) % 5) * 0.09}
                fill={i % 3 === 0 ? "#fff" : `hsl(${born.hue} 95% ${64 + (i % 4) * 6}%)`}
                opacity={0.35 + ((i * 3) % 5) * 0.12}
              >
                <animateMotion
                  dur={`${560 + (i % 6) * 26}ms`}
                  begin={`${i * 22}ms`}
                  fill="freeze"
                  path={path}
                />
                <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.15;0.8;1" dur={`${760 + (i % 6) * 26}ms`} begin={`${i * 22}ms`} fill="freeze" />
              </circle>
            ))}

            {/* The head of the delivery, brighter than the embers. */}
            <circle className="swarm-head" r="0.8" fill="#fff">
              <animateMotion dur="620ms" fill="freeze" path={path} />
            </circle>
          </svg>
        );
      })()}

      {born && (
        <>
          <span
            className="swarm-burst"
            style={{ left: `${born.x}%`, top: `${born.y}%` }}
            aria-hidden
          />
          {/* Two shock rings land with the particle, 560 ms down the thread. */}
          <span
            className="swarm-ring"
            style={{ left: `${born.x}%`, top: `${born.y}%`, animationDelay: "560ms" }}
            aria-hidden
          />
          <span
            className="swarm-ring wide"
            style={{ left: `${born.x}%`, top: `${born.y}%`, animationDelay: "700ms" }}
            aria-hidden
          />
          <span
            className="swarm-callout"
            style={{
              left: `${(50 + born.x) / 2 + 4}%`,
              top: `${(40 + born.y) / 2 - 8}%`,
              "--hue": born.hue,
            } as React.CSSProperties}
          >
            summoning · {born.agent.name}
          </span>
        </>
      )}

      {ring.map(({ agent, x, y, hue }) => {
        const isBorn = agent.id === bornId;
        return (
          <button
            key={agent.id}
            type="button"
            className={`swarm-orb ${isBorn ? "born" : ""} ${agent.state}`}
            style={
              {
                left: `${x}%`,
                top: `${y}%`,
                "--hue": hue,
                "--delay": `${hash(agent.id) * 2.4}s`,
              } as React.CSSProperties
            }
            onClick={() => onSelect(agent.id)}
            title={`${agent.name} — ${agent.state}`}
            aria-label={`${agent.name}, ${agent.state}`}
          >
            <i className="swarm-core" />
            <span className="swarm-name">
              {agent.name.split("").map((ch, i) => (
                <b key={i} style={{ animationDelay: `${180 + i * 24}ms` }}>
                  {ch}
                </b>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
