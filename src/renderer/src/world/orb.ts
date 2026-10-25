import * as THREE from "three";
import { WORLD } from "./constants";
import { dotTexture, glowTexture, orbGeometry, orbMaskGeometry } from "./materials";
import { orbFragment, orbMaskFragment, orbMaskVertex, orbVertex } from "./shaders";
import { derivePalette, type Palette } from "./palette";
import { approach, frameLerp, themeGlide } from "./motion";
import type { AgentState } from "../../../shared/types";

/**
 * The orb layer: one point-cloud sphere, an equatorial band and a soft halo.
 *
 * Timings come from OrbStandIn (`Ep` + the `rp` vertex shader):
 *   - surface wave: sin(x·3 + t·0.8) · sin(y·2 + t·0.6) · noiseAmp  → 7.854 / 10.472 s
 *   - y rotation: elapsed × 0.15 rad/s → 41.89 s per turn
 *   - birth: progress +0.6/s (1.667 s), 29 % size boost
 *   - dissolve: +0.8/s (1.25 s), size → 0.05
 *   - thinking: +1.8 brightness, +0.08 noise, +0.4 rad/s spin, attack 5/s, release 1.2/s
 *   - colour glide: 1 − exp(−dt·2.5) (FlowWaveBackdrop's palette lerp)
 */

export interface Orb {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  spawn(): void;
  dissolve(): void;
  setState(state: AgentState, accent: string): void;
  update(time: number, dt: number, motion: number): void;
  dispose(): void;
}

export function createOrb(accent: string, initialState: AgentState): Orb {
  const dot = dotTexture();
  const glow = glowTexture();
  const { geometry } = orbGeometry(WORLD.orb.rows, WORLD.orb.perRing, WORLD.orb.bandDots);
  const palette = derivePalette(accent, initialState);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: WORLD.orb.radius },
      uBrightness: { value: WORLD.orb.baseBrightness },
      uNoiseAmp: { value: WORLD.orb.noiseAmp },
      uDotSize: { value: WORLD.orb.dotSize },
      uDotSizeBand: { value: WORLD.orb.dotSizeBand },
      uSummon: { value: 0 },
      uSummonSpread: { value: WORLD.orb.summonSpread },
      uVoice: { value: 0 },
      uDissolve: { value: 0 },
      uBirth: { value: 0 },
      uFocus: { value: 1 },
      uPixel: { value: 1 },
      uColorLow: { value: palette.low.clone() },
      uColorHigh: { value: palette.high.clone() },
      uTint: { value: palette.tint.clone() },
      uTintAmount: { value: palette.tintAmount },
    },
    vertexShader: orbVertex,
    fragmentShader: orbFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.material.depthTest = true;
  // Draw the orb after the sea. Both are additive transparencies, so depth alone
  // lets near water paint over the sphere; the reference parts the water instead.
  points.renderOrder = 2;

  // Opaque depth shell: writes depth only, so beads on the far hemisphere are
  // occluded and the front rows stay a single layer. Sharing the uniform objects
  // with the points keeps both meshes deformed identically each frame.
  const maskGeometry = orbMaskGeometry();
  const maskMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: material.uniforms.uTime,
      uRadius: material.uniforms.uRadius,
      uNoiseAmp: material.uniforms.uNoiseAmp,
      uVoice: material.uniforms.uVoice,
      uDissolve: material.uniforms.uDissolve,
    },
    vertexShader: orbMaskVertex,
    fragmentShader: orbMaskFragment,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
  });
  const mask = new THREE.Mesh(maskGeometry, maskMaterial);
  mask.frustumCulled = false;
  mask.renderOrder = 1;

  const haloMaterial = new THREE.SpriteMaterial({
    map: glow,
    color: palette.high.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.setScalar(WORLD.orb.haloScale);

  const group = new THREE.Group();
  group.add(halo, mask, points);

  let birth = 0;
  // The reference lights a newborn orb at 2.2× and lets it settle over ~1.2 s.
  let birthGlow = 0;
  let emerge = 0;
  let dissolve = 0;
  let targetDissolve = 0;
  let voice = 0;
  let thinking = 0;
  let thinkingTarget = initialState === "thinking" ? 1 : 0;
  let spin = 0;

  const target: Palette = {
    low: palette.low.clone(),
    high: palette.high.clone(),
    tint: palette.tint.clone(),
    tintAmount: palette.tintAmount,
  };

  const setState = (next: AgentState, nextAccent: string) => {
    const p = derivePalette(nextAccent, next);
    target.low.copy(p.low);
    target.high.copy(p.high);
    target.tint.copy(p.tint);
    target.tintAmount = p.tintAmount;
    thinkingTarget = next === "thinking" ? 1 : 0;
  };

  return {
    group,
    material,
    spawn() {
      birth = 0;
      birthGlow = 1;
      emerge = 0;
      targetDissolve = 0;
    },
    dissolve() {
      targetDissolve = 1;
    },
    setState,
    update(time, dt, motion) {
      // birthProgress += dt * 0.6 → 1.667 s; the shader reveals over 0..1.
      if (birth < 1) birth = Math.min(1, birth + dt * WORLD.orb.birthRate);
      material.uniforms.uBirth.value = birth;

      // `.orb-emerging` (reference CSS): 650 ms, cubic-bezier(.34,1.56,.64,1),
      // scale 0 → 1.12 at 55 % → .96 at 75 % → 1. The summon is visible here,
      // in the geometry, not only in the DOM overlay. The shell also converges
      // from 1.32 × radius on the same clock, staggered per dot in the shader.
      if (emerge < 1) emerge = Math.min(1, emerge + dt / WORLD.orb.summonSeconds);
      material.uniforms.uSummon.value = emerge;
      const e = emerge;
      const emergeScale =
        e < 0.55
          ? (e / 0.55) * 1.12
          : e < 0.75
            ? 1.12 + ((e - 0.55) / 0.2) * (0.96 - 1.12)
            : 0.96 + ((e - 0.75) / 0.25) * 0.04;
      group.scale.setScalar(emergeScale);

      // dissolve += dt * 0.8 → 1.25 s.
      if (dissolve < targetDissolve) dissolve = Math.min(targetDissolve, dissolve + dt * WORLD.orb.dissolveRate);
      else if (dissolve > targetDissolve) dissolve = Math.max(targetDissolve, dissolve - dt * WORLD.orb.dissolveRate);
      material.uniforms.uDissolve.value = dissolve;

      // Voice attack/release: 0.85 / 0.18 per frame at 60 fps.
      voice += (0 - voice) * frameLerp(voice > 0 ? WORLD.orb.voiceRelease : WORLD.orb.voiceAttack, dt);
      material.uniforms.uVoice.value = voice;

      // Thinking accumulator: attack 5/s, release 1.2/s, snap below 0.01.
      thinking += (thinkingTarget - thinking) * approach(dt, thinkingTarget ? WORLD.orb.thinkAttack : WORLD.orb.thinkRelease);
      if (Math.abs(thinkingTarget - thinking) < 0.01) thinking = thinkingTarget;

      material.uniforms.uTime.value = time;
      material.uniforms.uNoiseAmp.value =
        WORLD.orb.noiseAmp + voice * WORLD.orb.voiceNoise + thinking * WORLD.orb.thinkNoise;
      if (birthGlow > 0) birthGlow = Math.max(0, birthGlow - dt * 0.85);
      material.uniforms.uBrightness.value =
        WORLD.orb.baseBrightness * (1 + birthGlow * 1.2) +
        voice * WORLD.orb.voiceBrightness +
        thinking * WORLD.orb.thinkBrightness;

      // Palette glide, 2.5/s. A state change settles in ~1.8 s, not instantly.
      const k = themeGlide(dt);
      (material.uniforms.uColorLow.value as THREE.Color).lerp(target.low, k);
      (material.uniforms.uColorHigh.value as THREE.Color).lerp(target.high, k);
      (material.uniforms.uTint.value as THREE.Color).lerp(target.tint, k);
      material.uniforms.uTintAmount.value += (target.tintAmount - material.uniforms.uTintAmount.value) * k;
      haloMaterial.color.lerp(target.high, k);

      // rotation.y = elapsed * 0.15 + accumulated birth/thinking spin.
      spin += dt * motion * (WORLD.orb.birthSpin * (1 - birth) + WORLD.orb.thinkSpin * thinking);
      group.rotation.y = time * WORLD.orb.rotation + spin;

      // The halo is the orb's atmosphere: a wide, soft field that lifts the dots
      // off the page and makes the bloom bloom. Reference glow reads at ~40 %.
      haloMaterial.opacity = (0.42 + voice * 0.06) * (1 - dissolve) * (0.6 + 0.4 * birth);
      halo.scale.setScalar(WORLD.orb.haloScale * (1 + voice * 0.04));
    },
    dispose() {
      geometry.dispose();
      maskGeometry.dispose();
      material.dispose();
      maskMaterial.dispose();
      dot.dispose();
      glow.dispose();
      haloMaterial.dispose();
    },
  };
}
