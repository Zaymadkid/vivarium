import * as THREE from "three";
import { WORLD } from "./constants";
import { dustGeometry } from "./materials";
import { dustFragment, dustVertex } from "./shaders";

/**
 * Near-field bokeh. Follows the camera so the motes always read as depth.
 *
 * Reference: uTime = seconds × 8, warp drift b = 0.02 per (already 8×) second,
 * point size = size × uRes.y / 900 / −z with a one-pixel floor.
 */
export interface Dust {
  points: THREE.Points;
  setSize(width: number, height: number, pixelRatio: number): void;
  update(time: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function createDust(): Dust {
  const geometry = dustGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(WORLD.dust.color) },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    setSize(width, height, pixelRatio) {
      (material.uniforms.uRes.value as THREE.Vector2).set(width * pixelRatio, height * pixelRatio);
    },
    update(time, camera) {
      material.uniforms.uTime.value = time * WORLD.dust.timeScale;
      points.position.copy(camera.position);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
