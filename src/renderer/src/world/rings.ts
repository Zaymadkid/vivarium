import * as THREE from "three";

/**
 * Rings around the focused orb.
 *
 * A Fibonacci dot sphere is rotationally symmetric, so spinning it on Y reads as
 * a still image — which is exactly what "the ball is so still" meant. The
 * reference marks the focused agent with orbit/arc geometry, and its HUD pulses
 * use `hc-pulse` (1 → 1.55, fade) and `hc-pulse-far` (1 → 2.1, fade). Both are
 * reproduced here as geometry so the motion is anchored to the orb rather than
 * floating in the DOM:
 *
 *   orbit A   radius 1.62, tilt 68°,  0.24 rad/s
 *   orbit B   radius 1.86, tilt −24°, −0.15 rad/s
 *   pulse     1 → 1.55 and 1 → 2.1, opacity .55 → 0, 3.2 s loop, 0.5 s apart
 */

export interface Rings {
  group: THREE.Group;
  update(time: number, dt: number, motion: number, energy: number): void;
  setColor(color: THREE.Color): void;
  dispose(): void;
}

function thinRing(radius: number, colour: THREE.Color, opacity: number) {
  const geometry = new THREE.RingGeometry(radius - 0.008, radius + 0.008, 192, 1);
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  return mesh;
}

export function createRings(colour: THREE.Color): Rings {
  const group = new THREE.Group();

  const orbitA = thinRing(1.62, colour, 0.5);
  const orbitB = thinRing(1.86, colour, 0.28);
  orbitA.rotation.x = THREE.MathUtils.degToRad(68);
  orbitA.rotation.z = THREE.MathUtils.degToRad(12);
  orbitB.rotation.x = THREE.MathUtils.degToRad(-24);
  orbitB.rotation.z = THREE.MathUtils.degToRad(48);

  const pulseInner = thinRing(1.08, colour, 0);
  const pulseFar = thinRing(1.08, colour, 0);
  pulseInner.rotation.x = THREE.MathUtils.degToRad(74);
  pulseFar.rotation.x = THREE.MathUtils.degToRad(-16);

  group.add(orbitA, orbitB, pulseInner, pulseFar);

  const pulsePeriod = 3.2;
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);

  return {
    group,
    setColor(next) {
      for (const child of group.children) {
        ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.copy(next);
      }
    },
    update(time, _dt, motion, energy) {
      // Orbit angles advance with the world clock; reduced motion freezes them.
      orbitA.rotation.y = time * motion * 0.24;
      orbitB.rotation.y = time * motion * -0.15;

      const span = pulsePeriod * (energy > 0.5 ? 0.62 : 1);

      for (const [ring, maxScale, phase] of [
        [pulseInner, 1.55, 0] as const,
        [pulseFar, 2.1, 0.5] as const,
      ]) {
        const local = ((time * motion + phase) % span) / span;
        const k = ease(local);
        const scale = 1 + (maxScale - 1) * k;
        ring.scale.setScalar(scale);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k) * (1 - energy * 0.25);
      }
    },
    dispose() {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    },
  };
}
