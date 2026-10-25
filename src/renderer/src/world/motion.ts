import { useEffect, useState } from "react";
import { WORLD } from "./constants";

/**
 * Motion helpers.
 *
 * The app has two motion switches: the OS-level `prefers-reduced-motion` and
 * the in-app `Settings.reducedMotion`, which App mirrors onto
 * `document.documentElement.dataset.motion`. Either one slows the world down to
 * a breathing still frame; neither unmounts it.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * How fast ambient motion should run.
 *
 * The in-app switch is authoritative: on → 0 (a still frame, as the setting
 * promises). The OS preference only *slows* the world (0.35), it does not stop
 * it. Freezing on `prefers-reduced-motion` made the orb read as a static image
 * on machines where Windows "animation effects" are off — which is the default
 * on many installs, and looked exactly like a broken animation.
 */
export function useMotionScale(settingReduced: boolean): number {
  // The OS preference is deliberately *not* consulted here. On Windows, "animation
  // effects" off is common, and honouring it froze the world clock (`time` never
  // advanced), which read as a broken animation rather than a calm one. Motion is
  // owned by the app's own Motion setting, mirrored onto data-motion for the DOM.
  return settingReduced ? 0 : 1;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent approach factor: `1 - exp(-dt * rate)`. */
export const approach = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/**
 * The reference writes some lerps per frame rather than per second
 * (`pointerDamp = 0.06`, `cursor.lerp(…, 0.12)`, voice attack/release).
 * At 60 fps the per-frame amount `k` becomes `1 - (1 - k)^(60·dt)`.
 */
export const frameLerp = (perFrame: number, dt: number) =>
  1 - Math.pow(1 - perFrame, 60 * dt);

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Reference palette glide: `k = 1 - exp(-dt * 2.5)` in FlowWaveBackdrop's rAF.
 * Time constant 0.4 s; 63 % in 400 ms, 99 % in 1.84 s.
 */
export const themeGlide = (dt: number) => 1 - Math.exp(-dt * WORLD.colourGlide);

/** A spring is settled when it is this close; used by the focus framing. */
export const isSettled = (velocity: number, distance: number) =>
  Math.abs(velocity) < WORLD.reduced.springEpsilon && Math.abs(distance) < WORLD.reduced.springEpsilon;
