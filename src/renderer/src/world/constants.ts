/**
 * Literal constants for the world, retimed from the reference chunks.
 *
 * Every number here is quoted with its origin in `docs/ui/MOTION-WORLD.md`; the
 * chunk + symbol is recorded next to each block. Where the reference works in
 * pre-scale units (the sea displaces before `uScale`), the conversion is shown,
 * so the number in the shader can be compared against the number in the chunk.
 *
 * Nothing else in the renderer may hold a timing constant. Numbers that the
 * reference hardcodes inside a shader stay inline in `shaders.ts`, on the line
 * that uses them, so the GLSL can be diffed against the chunk line for line;
 * they are not mirrored here, where editing them would change nothing.
 */

export const WORLD = {
  /** Page paint behind the canvas. */
  bg: 0x050506,
  bgHex: "#050506",

  camera: {
    fov: 42,
    near: 0.1,
    far: 100,
    /**
     * Framing: the orb fills the middle third and the sea takes the bottom half,
     * which is the reference's composition. The backdrop camera there is
     * (0, 7, 16) looking at (0, 0, 2) — far wider than the orb layer — so the
     * angle is matched here rather than the literal vector.
     */
    position: [0, 2.05, 6.6] as [number, number, number],
    /**
     * The reference frames the orb at 43.5 % of window height with the sea
     * horizon near 55 %; looking slightly below the orb lifts both.
     */
    lookAt: [0, -0.3, 0] as [number, number, number],
  },

  orb: {
    /** 368 px on a 1456 px window = 25.3 % of width; ours was 29.4 % at 1.26. */
    radius: 1.25,
    /**
     * Beaded lat/long shell: 52 rows × up to 96 dots, ~3.9k points total.
     * The reference shows individual dots with dark gaps and visible latitude
     * rows, so it cannot be a dense spiral: 20k points at 1 px read as grain.
     */
    rows: 52,
    perRing: 104,
    /**
     * No separate equatorial dot ring: on our geometry it drew a hard bright
     * slash across the sphere. The reference's equator glow is a 3D ring
     * (`rings.ts`), which is what the orbit arcs around the orb already are.
     */
    bandDots: 0,
    /** Reference dot ≈ 2 px core inside a 6 px halo at 1456 px wide. */
    dotSize: 8.2,
    dotSizeBand: 5.6,
    /** Sprite diameter in world units: sphere is 2.5, glow ≈ 1.36 × that. */
    haloScale: 3.4,

    /* ---- motion ---------------------------------------------------------
     * Source: OrbStandIn `rp` vertex shader + `Ep` frame body.
     * Breathing is a two-frequency surface wave, not one global sine:
     *   sin(x * 3.0 + t * 0.8) * sin(y * 2.0 + t * 0.6) * u_noise_amp
     * Periods: 2π/0.8 = 7.854 s, 2π/0.6 = 10.472 s.
     */
    /**
     * Silhouette morph: the product of the two sines swells one side of the
     * sphere into a lobe and lets it travel. The chunk's `u_noise_amp` is .18,
     * but the reference's own frames only vary their width by 3.5 % (367 px vs
     * 392 px at 1456 wide); .18 varied ours by 9 %, which read as a squash.
     */
    noiseAmp: 0.065,
    /** Summon: dots converge from 1.32 × radius over the same 650 ms as the scale. */
    summonSpread: 0.32,
    summonSeconds: 0.65,

    /** `rotation.y = elapsed * 0.15` in the reference; raised so the turn reads. */
    rotation: 0.19,
    /** Birth adds 0.25 rad/s × (1 − birth) while revealing. */
    birthSpin: 0.25,

    /** `birthProgress += dt * 0.6` → 1.667 s to full. */
    birthRate: 0.6,
    /** `dissolve += dt * 0.8` → 1.25 s to gone. */
    dissolveRate: 0.8,

    /* Voice: brightness +6.96, noise +0.52. (The shader's own swell —
     * radius +15 %, point size +20 % — is inline in `shaders.ts`.) */
    voiceBrightness: 6.96,
    voiceNoise: 0.52,
    /** Voice smoothing per frame at 60 fps: attack 0.85, release 0.18. */
    voiceAttack: 0.85,
    voiceRelease: 0.18,

    /* Thinking: brightness +1.8, noise +0.08, spin 0.4 rad/s, attack 5/s, release 1.2/s. */
    thinkBrightness: 1.8,
    thinkNoise: 0.08,
    thinkSpin: 0.4,
    thinkAttack: 5,
    thinkRelease: 1.2,

    /** Our tuned base; the reference multiplies colour by 1.15 × 1.25 (focused). */
    baseBrightness: 0.9,
  },

  bloom: { strength: 0.62, radius: 0.7, threshold: 0 },

  /** The flame composite: `uFlameAmt` 0.2 in the reference, tuned for our exposure. */
  flame: { amount: 0.085, gain: 1 },

  sea: {
    cols: 264,
    rows: 152,
    width: 44,
    /** The field starts just in front of the camera and runs to the horizon. */
    near: -2,
    depth: 30,
    /** Plane height in world units; the shader lifts it by the wave. */
    height: -1.62,
    /** uSize * (10 / -z), floor 1.5 px. */
    size: 3.9,
    floorPx: 1.5,

    /* ---- motion ---------------------------------------------------------
     * Source: FlowWaveBackdrop sea shader + rAF `xe`.
     * Two snoise octaves, sampled pre-scale at 0.08 and 0.16, time scales
     * 0.15·uFlow / 0.3·uFlow with uFlow = 0.45:
     *   ω1 = 0.0675 rad/s (93.1 s), ω2 = 0.135 rad/s (46.5 s)
     * Wavelengths pre-scale 12.5 and 6.25; × uScale 0.275 → 3.4375 / 1.71875 world units.
     * Amplitudes 2.0 and 0.8 × waveHeight 3 × uScale 0.275 → 1.65 / 0.66 world units.
     */
    waveHeight: 3,
    worldScale: 0.275,
    crestCap: 3,
    flow: 0.45,
    wavelength1: 12.5,
    wavelength2: 6.25,
    waveSpeed1: 0.15,
    waveSpeed2: 0.3,
    waveAmp1: 2.0,
    waveAmp2: 0.8,
    /** uStream += dt * (uFlow * 2) * 4 = 3.6 pre-scale units/s → 0.99 world units/s. */
    stream: 3.6,

    opacity: 0.55,
    brightness: 0.42,
    appearMs: 1400,
    appearDelayMs: 200,

    cursor: {
      /** Ray/plane hit height for the pointer. */
      planeY: -3.5,
      /** world.lerp(hit, 0.12) per frame. */
      lerp: 0.12,
      radius: 7,
      strength: 0.9,
      /** activity += ((active && sinceLastMove < 3) - activity) * 0.06 per frame. */
      activity: 0.06,
      decayMs: 3000,
    },
    orbDip: 0.9,
    /** repel = 1 − smoothstep(uOrbR * 0.55, uOrbR * 1.5, distance). */
    orbDipInner: 0.55,
    orbDipOuter: 1.5,
    orbDipFade: 0.8,
  },

  dust: {
    /**
     * Source: FlowWaveBackdrop dust points + `warp` shader.
     * 40 points, size 24 × (0.4…1.4), uTime = seconds × 8.
     * The warp itself — c 0.9, a 1.9, b 0.02, s 0.05, pos × 4, warp × 1.2,
     * fades 5…6.5 / 0…0.5, alpha 0.6 — is the chunk's GLSL verbatim and lives in
     * `shaders.ts`.
     */
    count: 40,
    size: 24,
    color: "#FF8C42",
    timeScale: 8,
  },

  /** Cursor → camera lerp per frame (0.06 at 60 fps). */
  parallax: 0.06,
  /** Camera position amplitude: x 0.35, y 0.35 × 0.3 = 0.105. */
  parallaxRange: { x: 0.35, y: 0.105 },
  /** look-at x = T.x * 0.35 * 0.5; y stays at 0. */
  lookAhead: 0.5,

  /** Palette glide: 1 − exp(−dt × 2.5) → 0.4 s time constant. */
  colourGlide: 2.5,

  /** Agent colour rules. */
  accent: {
    rotate: 150,
    tolerance: 40,
    greySaturation: 0.08,
    brainBlue: "#4FB3FF",
  },

  /** State tints, mixed into the orb's two-tone shading. */
  state: {
    idle: "#FFFFFF",
    thinking: "#B9F5DF",
    blocked: "#FFB627",
    error: "#FF6B6B",
  },

  reduced: {
    /** Under this, a spring/lerp is considered settled. */
    springEpsilon: 0.18,
    /** Context-loss grace before swapping to the static sea. */
    contextGraceMs: 1000,
    /** Idle settle window used by the cascade. */
    settleMs: 2000,
  },
} as const;

export type WorldConstants = typeof WORLD;
