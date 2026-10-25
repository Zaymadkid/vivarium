/**
 * GLSL for the orb, the sea and the dust.
 *
 * The numbers are the reference's, extracted in `docs/ui/MOTION-WORLD.md`:
 * the orb breathes on 0.8 / 0.6 rad/s, the sea samples two simplex-noise octaves
 * whose periods are 93.1 s and 46.5 s and scrolls at 3.6 pre-scale units per
 * second, and the dust drifts at 0.02 × t inside an 8× clock.
 *
 * The sea field itself is the shipped formula — `snoise(vec3(x·0.08, z·0.08,
 * t·0.15·flow)) · 2 + snoise(vec3(x·0.16, z·0.16, t·0.3·flow)) · 0.8` — not a ring
 * approximation. Ring sines moved at the same periods but read as concentric
 * bands rather than water.
 */

import { SNOISE } from "./noise";

export const orbVertex = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uBrightness;
  uniform float uNoiseAmp;
  uniform float uVoice;
  uniform float uDissolve;
  uniform float uBirth;
  uniform float uFocus;
  uniform float uPixel;
  uniform float uDotSize;
  uniform float uDotSizeBand;
  uniform float uSummon;
  uniform float uSummonSpread;

  attribute float aSeed;
  attribute float aBand;

  varying float vAlpha;
  varying float vTone;
  varying float vSeed;

  void main() {
    vSeed = aSeed;
    vec3 base = position;
    vec3 norm = normalize(base);
    vec3 p = norm * uRadius;

    // OrbStandIn: sin(x*3 + t*0.8) * sin(y*2 + t*0.6) * u_noise_amp.
    // This product term is the silhouette: it holds one side of the sphere out
    // into a lobe and carries it around as uTime advances. With big dots it is
    // the most legible motion in the scene — do not replace it with a uniform
    // pulse, and do not turn the amplitude down to keep a perfect circle.
    float wave = sin(base.x * 3.0 + uTime * 0.8) *
                 sin(base.y * 2.0 + uTime * 0.6) * uNoiseAmp;
    p += norm * wave;

    // Voice swells the sphere by 15 % at full amplitude.
    p *= 1.0 + uVoice * 0.15;

    // Summon: the shell converges from uSummonSpread outward-in, staggered by
    // seed so the dots arrive as a wave instead of a single inflating balloon.
    float arrive = clamp((uSummon - aSeed * 0.35) / 0.65, 0.0, 1.0);
    p *= mix(1.0 + uSummonSpread, 1.0, arrive);

    // Dissolve collapses to a point rather than fading in place.
    p *= mix(1.0, 0.05, uDissolve);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    float baseSize = mix(uDotSize, uDotSizeBand, aBand);
    // Birth: 29 % size boost over the first 0.7 of uBirth.
    float boost = 1.0 + (1.0 - smoothstep(0.0, 0.7, uBirth)) * 0.29;
    gl_PointSize = baseSize * boost * uFocus * (8.0 / max(0.001, -mv.z)) * uPixel;
    gl_PointSize *= 1.0 + uVoice * 0.2;
    gl_PointSize = mix(gl_PointSize, 0.05, uDissolve);
    gl_Position = projectionMatrix * mv;

    // The limb is where the rows compress, so it reads brighter than the face
    // in the reference; never dim it, the depth shell already gives the edge.
    vec3 viewNormal = normalize(normalMatrix * norm);
    float rim = smoothstep(0.0, 0.8, 1.0 - abs(viewNormal.z));
    vTone = clamp(base.y * 0.5 + 0.5 + aBand * 0.15, 0.0, 1.0);
    vAlpha = (0.58 + rim * 0.1) * smoothstep(0.0, 0.3, uBirth) * (1.0 - uDissolve) * uBrightness;
  }
`;

/**
 * Depth-only shell drawn behind the beads. It is the same wave-deformed sphere,
 * 1.5 % smaller, so every dot on the far hemisphere fails the depth test and the
 * far side contributes no second layer. Culling by normal instead tore holes at
 * the lobe folds; occlusion is what the reference's clean rows imply.
 */
export const orbMaskVertex = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uNoiseAmp;
  uniform float uVoice;
  uniform float uDissolve;

  void main() {
    vec3 base = position;
    vec3 norm = normalize(base);
    vec3 p = norm * uRadius;

    float wave = sin(base.x * 3.0 + uTime * 0.8) *
                 sin(base.y * 2.0 + uTime * 0.6) * uNoiseAmp;
    p += norm * wave;
    p *= 1.0 + uVoice * 0.15;
    p *= mix(1.0, 0.05, uDissolve);

    // Just inside the point shell: front beads stay in front of the mask, far
    // beads stay behind it. Any deeper and the mask clips the outer ring of
    // beads, leaving a smooth non-beaded edge the reference does not have.
    p *= 0.997;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const orbMaskFragment = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

export const orbFragment = /* glsl */ `
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;
  uniform vec3 uTint;
  uniform float uTintAmount;
  uniform float uTime;

  varying float vAlpha;
  varying float vTone;
  varying float vSeed;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    // Gaussian-ish bead: a 2 px core inside a wide soft halo, like the
    // reference's dots (which are glows, not stamped discs).
    float disc = pow(smoothstep(0.5, 0.0, r), 1.7);

    vec3 col = mix(uColorLow, uColorHigh, vTone);
    col = mix(col, uTint, uTintAmount * 0.55);
    // Light centre on every dot: the reference's points are beads with a core.
    col += vec3(0.36) * pow(max(0.0, 1.0 - r * 2.2), 3.0);

    // Travelling shimmer: each bead brightens on its own phase, so the shell
    // reads as moving even between the slower silhouette waves.
    float shimmer = 0.72 + 0.38 * sin(uTime * 1.15 + vSeed * 6.2831);
    gl_FragColor = vec4(col, disc * clamp(vAlpha * shimmer, 0.0, 1.0));
  }
`;

export const seaVertex = /* glsl */ `
  uniform float uTime;
  uniform float uStream;
  uniform float uWaveHeight;
  uniform float uWorldScale;
  uniform float uFlow;
  uniform float uSize;
  uniform float uCrestCap;
  uniform float uPixel;
  uniform float uAspect;

  uniform vec3 uCursor;
  uniform float uActivity;
  uniform float uRepelRadius;
  uniform float uRepelStrength;

  uniform vec2 uOrbNdc;
  uniform float uOrbR;
  uniform float uOrbDip;

  varying float vFade;
  varying vec3 vColor;
  varying float vH;

  uniform vec3 uColLow;
  uniform vec3 uColHigh;

  ${SNOISE}

  void main() {
    vec3 wp = vec3(position.x, 0.0, position.z);

    // The sea scrolls as one field: uStream translates z, uTime only evolves it.
    float zc = wp.z + uStream;

    float wn = snoise(vec3(wp.x * 0.11, zc * 0.11, uTime * 0.15 * uFlow)) * 2.0;
    wn += snoise(vec3(wp.x * 0.23, zc * 0.23, uTime * 0.3 * uFlow)) * 0.8;
    wn += snoise(vec3(wp.x * 0.46, zc * 0.46, uTime * 0.6 * uFlow)) * 0.28;

    // The grid is already in world metres, so only the wave is converted from
    // the reference's pre-scale units (height 3 × uScale 0.275).
    wp.y += wn * uWaveHeight * uWorldScale;
    wp.y = min(wp.y, uCrestCap * uWorldScale);

    vec3 finalPos = wp;

    vec4 modelPosition = modelMatrix * vec4(finalPos, 1.0);

    vec3 toP = modelPosition.xyz - uCursor;
    float cd = length(toP);
    float fall = smoothstep(uRepelRadius, 0.0, cd);
    modelPosition.xyz += normalize(toP + vec3(0.0001)) * fall * uRepelStrength * uActivity;

    vec4 mvPosition = viewMatrix * modelPosition;

    float colMix = smoothstep(-3.0, 3.0, wn);
    vColor = mix(uColLow, uColHigh, clamp(colMix, 0.0, 1.0));
    vH = wn;

    vFade = 1.0;

    gl_PointSize = uSize * (10.0 / max(0.001, -mvPosition.z));
    gl_PointSize = max(gl_PointSize, 1.5);
    gl_Position = projectionMatrix * mvPosition;

    // The orb parts the sea: in screen space the water dips away from its disc
    // and thins out, so the waves never read as covering the orb.
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 dv = ndc - uOrbNdc;
    dv.x *= uAspect;

    float dd = length(dv);
    float repel = 1.0 - smoothstep(uOrbR * 0.55, uOrbR * 1.5, dd);
    modelPosition.y -= repel * repel * uOrbDip;
    mvPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * mvPosition;

    vFade *= 1.0 - repel * 0.8;

    // Shadow pool: the water directly under the orb keeps its points but goes
    // dark, which pops the orb against it.
    float shade = smoothstep(0.12, 0.9, repel);
    vColor *= 1.0 - shade * 0.85;

    // The parted water laps brighter at the dip's rim.
    float rimGlow = smoothstep(0.02, 0.3, repel) * (1.0 - smoothstep(0.3, 0.7, repel));
    vColor += uColHigh * rimGlow * 0.4;
  }
`;

export const seaFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uAppear;

  varying float vFade;
  varying vec3 vColor;

  void main() {
    vec2 xy = gl_PointCoord - 0.5;
    float ll = length(xy);
    if (ll > 0.5) discard;
    float a = smoothstep(0.5, 0.1, ll);
    gl_FragColor = vec4(vColor * uBrightness, vFade * a * uOpacity * uAppear);
  }
`;

export const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform vec2 uRes;
  attribute float aSize;
  varying float vAlpha;

  // FlowWaveBackdrop dust warp: c 0.9, a 1.9, b 0.02, s 0.05.
  vec3 warp(vec3 p, float t) {
    float c = 0.9;
    float a = 1.9;
    float b = 0.02;
    float s = 0.05;
    p *= 2.0;
    p.x += c * sin(s * t + a * p.y) + t * b;
    p.y += c * cos(s * t + a * p.x);
    p.y += c * sin(s * t + a * p.z) + t * b;
    p.z += c * cos(s * t + a * p.y);
    p.z += c * sin(s * t + a * p.x) + t * b;
    p.x += c * cos(s * t + a * p.z);
    return cos(p + vec3(1.0, 2.0, 4.0));
  }

  void main() {
    vec3 v = position * 4.0 + warp(position, uTime) * 1.2;
    vec4 mv = modelViewMatrix * vec4(v, 1.0);

    float radius = length(v);
    float farF = 1.0 - smoothstep(5.0, 6.5, radius);
    float nearF = smoothstep(0.0, 0.5, -mv.z);
    vAlpha = farF * nearF;

    // Reference: size * uRes.y / 900 / -z, never below one pixel.
    gl_PointSize = max(1.0, aSize * uRes.y / 900.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

export const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float l = length(c);
    if (l > 0.5) discard;
    float tex = smoothstep(0.5, 0.0, l);
    gl_FragColor = vec4(uColor * tex, tex * vAlpha * 0.6);
  }
`;
