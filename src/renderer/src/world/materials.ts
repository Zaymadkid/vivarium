import * as THREE from "three";
import { WORLD } from "./constants";

/**
 * Sprites and geometry.
 *
 * The orb is a point cloud, so geometry is built once and never touched on the
 * CPU: the shaders do the breathing, the birth reveal and the dissolve. That is
 * what keeps a 16k-point sphere plus a 33k-point sea inside one 60 fps frame.
 */

/** Soft round sprite. Without this every point renders as a hard square. */
export function dotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.9)");
  g.addColorStop(0.72, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wider halo used behind the orb. */
export function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface OrbGeometry {
  geometry: THREE.BufferGeometry;
  /** Normalised birth coordinate per point, used by the reveal. */
  seeds: Float32Array;
}

/**
 * Beaded lat/long sphere plus an equatorial band.
 *
 * The reference's sphere is not a Fibonacci spiral: its dots sit in latitude
 * rows, and those rows are what make the surface read as a sphere rather than
 * as noise. Rows are spaced evenly in y; each ring carries a share of dots
 * proportional to its circumference, so the spacing stays roughly square from
 * pole to pole. A small per-dot jitter keeps it organic.
 */
export function orbGeometry(rows: number, perRing: number, band: number): OrbGeometry {
  const counts: number[] = [];
  let total = band;
  for (let row = 0; row < rows; row++) {
    const y = 1 - ((row + 0.5) / rows) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const n = Math.max(5, Math.round(perRing * r));
    counts.push(n);
    total += n;
  }

  const pos = new Float32Array(total * 3);
  const seed = new Float32Array(total);
  const isBand = new Float32Array(total);

  // Deterministic hash → 0..1. A plain sine hash keeps the geometry stable
  // between mounts, so screenshots and tests compare the same sphere.
  const hash = (n: number) => {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  let i = 0;
  for (let row = 0; row < rows; row++) {
    const rowJitter = (hash(row + 1) - 0.5) * 0.55;
    const yBase = 1 - ((row + 0.5) / rows) * 2;
    const n = counts[row];
    const ringOffset = hash(row + 101) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      // Jitter both along the ring and across it. Without this the columns line
      // up into meridians and the sphere reads as a striped barrel; the
      // reference keeps its rows but scatters the beads inside them.
      const aJit = (hash(row * 977 + k * 131) - 0.5) * (Math.PI * 2 * 0.22) / n;
      const yJit = (hash(row * 613 + k * 47) - 0.5) * (0.42 / rows);
      const y = Math.max(-0.999, Math.min(0.999, yBase + yJit + rowJitter / rows));
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = (k / n) * Math.PI * 2 + ringOffset + aJit;
      const wobble = 1 + (hash(row * 211 + k * 89) - 0.5) * 0.016;
      pos[i * 3] = Math.cos(a) * r * wobble;
      pos[i * 3 + 1] = y * wobble;
      pos[i * 3 + 2] = Math.sin(a) * r * wobble;
      seed[i] = (k * 0.61803398875 + row * 0.137) % 1;
      isBand[i] = 0;
      i++;
    }
  }

  for (let j = 0; j < band; j++) {
    const a = (j / band) * Math.PI * 2;
    const jitter = (((j * 7919) % 1000) / 1000 - 0.5) * 0.05;
    pos[i * 3] = Math.cos(a) * 1.004;
    pos[i * 3 + 1] = jitter;
    pos[i * 3 + 2] = Math.sin(a) * 1.004;
    seed[i] = (j * 0.377) % 1;
    isBand[i] = 1;
    i++;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aBand", new THREE.BufferAttribute(isBand, 1));
  geometry.computeBoundingSphere();

  return { geometry, seeds: seed };
}

/**
 * The depth-only shell behind the beads. An opaque sphere with colour writes
 * disabled: it exists purely so the far hemisphere's dots fail the depth test.
 * Tessellated high enough that the silhouette of the wave-deformed sphere is
 * smooth at 1.5× window scale.
 */
export function orbMaskGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 160, 120);
}

/**
 * The sea is a flat dot grid in world metres. The vertex shader lifts the dots
 * with two simplex-noise octaves; nothing here moves at runtime.
 */
export function seaGeometry(): THREE.BufferGeometry {
  const { cols, rows, width, depth, near } = WORLD.sea;
  const total = cols * rows;
  const pos = new Float32Array(total * 3);
  let p = 0;
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    const z = near + v * depth;
    for (let col = 0; col < cols; col++) {
      const u = col / (cols - 1);
      // The grid widens with depth so the far field reaches the frame edges.
      pos[p++] = (u - 0.5) * width * (0.42 + v * 1.05);
      pos[p++] = 0;
      pos[p++] = z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** 40 near-field motes, size 24 × (0.4…1.4) exactly as the reference builds them. */
export function dustGeometry(): THREE.BufferGeometry {
  const count = WORLD.dust.count;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * 2 - 1;
    pos[i * 3 + 1] = Math.random() * 2 - 1;
    pos[i * 3 + 2] = Math.random() * 2 - 1;
    size[i] = WORLD.dust.size * (0.4 + Math.random());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  return geometry;
}
