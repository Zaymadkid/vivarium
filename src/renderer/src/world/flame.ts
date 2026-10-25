import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * The flame field — the organic, swirling light under everything.
 *
 * Source: `FlowWaveBackdrop-YNrcubo1.js`, the final composite pass. The shipped
 * shader warps a 3D field with `warp3d` and tints it with two colours
 * (`uFlameA` `#FF6D00`, `uFlameB` `#FF8C42`) at `uFlameAmt` 0.2. It is composited
 * *after* bloom, so the field itself is never bloomed — that is why it reads as a
 * soft current behind the dots instead of a second glow source.
 *
 * Two changes, both deliberate:
 *   - colours come from the accent, so the current matches the orb;
 *   - the pass is additive over the rendered frame (`tDiffuse`) rather than a
 *     full replacement, because our chrome floats above a transparent canvas.
 */

export interface Flame {
  pass: ShaderPass;
  setColors(deep: THREE.Color, ember: THREE.Color): void;
  update(time: number): void;
  dispose(): void;
}

const FlameShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    iTime: { value: 0 },
    uFlameA: { value: new THREE.Color("#FF6D00") },
    uFlameB: { value: new THREE.Color("#FF8C42") },
    uFlameAmt: { value: 0.2 },
    uGain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float iTime;
    uniform vec3 uFlameA;
    uniform vec3 uFlameB;
    uniform float uFlameAmt;
    uniform float uGain;

    varying vec2 vUv;

    vec3 warp3d(vec3 pos, float t) {
      float curv = 0.8;
      float a = 1.9;
      float b = 0.7;
      pos *= 2.0;
      pos.x += curv * sin(t + a * pos.y) + t * b;
      pos.y += curv * cos(t + a * pos.x);
      pos.y += curv * sin(t + a * pos.z) + t * b;
      pos.z += curv * cos(t + a * pos.y);
      pos.z += curv * sin(t + a * pos.x) + t * b;
      pos.x += curv * cos(t + a * pos.z);
      return 0.5 + 0.5 * cos(pos.xyz + vec3(1.0, 2.0, 4.0));
    }

    void main() {
      vec2 uv = 2.0 * vUv - 1.0;

      vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime * 1.5), vec3(1.5));

      vec3 flame = 1.5 * uFlameA * w.x;
      flame *= w.y;
      flame += uFlameB * w.z;

      flame *= smoothstep(0.25, 1.0, abs(uv.y));

      float md = smoothstep(-0.7, 1.0, -uv.y * uv.x);
      flame *= md * md;

      vec3 base = texture2D(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(base + flame * uFlameAmt * uGain, 1.0);
    }
  `,
};

export function createFlame(): Flame {
  const pass = new ShaderPass(FlameShader);
  return {
    pass,
    setColors(deep, ember) {
      (pass.uniforms.uFlameA.value as THREE.Color).copy(deep);
      (pass.uniforms.uFlameB.value as THREE.Color).copy(ember);
    },
    update(time) {
      pass.uniforms.iTime.value = time;
    },
    dispose() {
      pass.dispose();
    },
  };
}
