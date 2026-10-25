import * as THREE from "three";
import { WORLD } from "./constants";
import { seaGeometry } from "./materials";
import { frameLerp } from "./motion";
import { seaFragment, seaVertex } from "./shaders";

/**
 * The sea: a dot field lifted by the reference's two simplex-noise octaves,
 * repelled by the cursor and parted under the orb.
 *
 * All motion happens in the vertex shader; the per-frame CPU work is the shared
 * flow accumulator plus a handful of uniform writes. That is the budget that lets
 * the sea stay GPU-side.
 *
 * Timings (see `docs/ui/MOTION-WORLD.md`):
 *   stream    = +3.6 pre-scale units/s (× 0.275 = 0.99 world units/s)
 *   octave 1  = 0.15 × uFlow = 0.0675 rad/s, wavelength 12.5 (3.4375 world)
 *   octave 2  = 0.30 × uFlow = 0.135  rad/s, wavelength 6.25 (1.71875 world)
 *   appear    = linear, 200 ms delay then 1,400 ms
 *   cursor    = lerp 0.12/frame, activity 0.06/frame, 3 s idle decay
 */

export interface Sea {
  points: THREE.Points;
  update(input: {
    time: number;
    dt: number;
    /** 0 under reduced motion: the flow freezes, the frame stays. */
    motion: number;
    cursor: THREE.Vector3 | null;
    activity: number;
    orbNdc: THREE.Vector2;
    orbRadius: number;
    aspect: number;
    pixelRatio: number;
  }): void;
  setPalette(low: THREE.Color, high: THREE.Color): void;
  dispose(): void;
}

export function createSea(low: THREE.Color, high: THREE.Color): Sea {
  const geometry = seaGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStream: { value: 0 },
      uAppear: { value: 0 },
      uWaveHeight: { value: WORLD.sea.waveHeight },
      uWorldScale: { value: WORLD.sea.worldScale },
      uFlow: { value: WORLD.sea.flow },
      uSize: { value: WORLD.sea.size },
      uCrestCap: { value: WORLD.sea.crestCap },
      uPixel: { value: 1 },
      uAspect: { value: 1 },
      uOpacity: { value: WORLD.sea.opacity },
      uBrightness: { value: WORLD.sea.brightness },
      uColLow: { value: low.clone() },
      uColHigh: { value: high.clone() },
      uCursor: { value: new THREE.Vector3(0, WORLD.sea.cursor.planeY, 6) },
      uActivity: { value: 0 },
      uRepelRadius: { value: WORLD.sea.cursor.radius },
      uRepelStrength: { value: WORLD.sea.cursor.strength },
      uOrbNdc: { value: new THREE.Vector2(0, 0.2) },
      uOrbR: { value: 0.25 },
      uOrbDip: { value: WORLD.sea.orbDip },
    },
    vertexShader: seaVertex,
    fragmentShader: seaFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.position.y = WORLD.sea.height;

  const cursor = new THREE.Vector3(0, WORLD.sea.cursor.planeY, 6);
  let appearElapsed = 0;
  let stream = 0;
  let activity = 0;
  let lastCursorChange = -99;

  return {
    points,
    setPalette(nextLow, nextHigh) {
      (material.uniforms.uColLow.value as THREE.Color).copy(nextLow);
      (material.uniforms.uColHigh.value as THREE.Color).copy(nextHigh);
    },
    update({ time, dt, motion, cursor: target, activity: userActivity, orbNdc, orbRadius, aspect, pixelRatio }) {
      appearElapsed += dt;

      // 200 ms delay, then a linear 1.4 s ramp — the reference clamps, no smoothstep.
      const delay = WORLD.sea.appearDelayMs / 1000;
      const ramp = WORLD.sea.appearMs / 1000;
      material.uniforms.uAppear.value = Math.min(1, Math.max(0, (appearElapsed - delay) / ramp));

      // The reference translates in pre-scale units: dt · flow · 2 · 4 = 3.6/s.
      stream += dt * motion * WORLD.sea.stream;
      material.uniforms.uStream.value = stream;
      material.uniforms.uTime.value = time;
      material.uniforms.uPixel.value = pixelRatio;
      material.uniforms.uAspect.value = aspect;

      if (target) {
        const before = cursor.clone();
        cursor.lerp(target, frameLerp(WORLD.sea.cursor.lerp, dt));
        if (before.distanceToSquared(cursor) > 1e-6) lastCursorChange = appearElapsed;
        (material.uniforms.uCursor.value as THREE.Vector3).copy(cursor);
      }

      // activity += ((active && sinceLastMove < 3) - activity) * 0.06 per frame.
      const wanted =
        userActivity && appearElapsed - lastCursorChange < WORLD.sea.cursor.decayMs / 1000 ? 1 : 0;
      activity += (wanted - activity) * frameLerp(WORLD.sea.cursor.activity, dt);
      material.uniforms.uActivity.value = activity;

      (material.uniforms.uOrbNdc.value as THREE.Vector2).copy(orbNdc);
      material.uniforms.uOrbR.value = Math.max(0.001, orbRadius);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
