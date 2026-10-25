import * as THREE from "three";
import { WORLD } from "./constants";
import type { AgentState } from "../../../shared/types";

/**
 * Colour rules.
 *
 * The orb is one hue — the companion's accent — shaded from a deep bed to a
 * bright crown. An earlier build rotated the secondary tone +150°, which the
 * reference never does: its sphere is a single warm field, and the only second
 * colour is the white-hot core of each dot. Grey accents (saturation < 0.08) are
 * still substituted with `#4FB3FF` so an uncoloured agent stays visible.
 *
 * Brightness is not here: it is the shader's `uBrightness` (base + thinking +
 * voice), so a state change cannot move it twice.
 */

export interface Palette {
  low: THREE.Color;
  high: THREE.Color;
  tint: THREE.Color;
  tintAmount: number;
}

const scratch = new THREE.Color();

export function accentColor(accent: string): THREE.Color {
  const base = new THREE.Color("#FF6D00");
  try {
    base.set(accent || "#FF6D00");
  } catch {
    base.set(WORLD.accent.brainBlue);
  }
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  if (hsl.s < WORLD.accent.greySaturation) base.set(WORLD.accent.brainBlue);
  return base;
}

export function derivePalette(accent: string, state: AgentState): Palette {
  const base = accentColor(accent);

  // Deep bed → the accent itself, with a touch of white in the crown.
  const low = base.clone().multiplyScalar(0.28);
  const high = base.clone().lerp(scratch.set("#ffffff"), 0.12);

  const tint = new THREE.Color(WORLD.state[state] ?? WORLD.state.idle);
  const tintAmount =
    state === "blocked" ? 0.9 : state === "error" ? 0.8 : state === "thinking" ? 0.18 : 0;

  return { low, high, tint, tintAmount };
}

/** The sea reads as the same material as the orb: deep foot, bright crest. */
export function seaPalette(accent: string): { low: THREE.Color; high: THREE.Color } {
  const base = accentColor(accent);
  return {
    low: base.clone().multiplyScalar(0.3),
    high: base.clone().lerp(scratch.set("#ffffff"), 0.18),
  };
}

/** Convert a pointer in element space to NDC. */
export function toNdc(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: (x / Math.max(1, width)) * 2 - 1, y: -(y / Math.max(1, height)) * 2 + 1 };
}
