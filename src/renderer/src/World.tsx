import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { AgentRecord, AgentState } from "../../shared/types";
import { WORLD } from "./world/constants";
import { createOrb, type Orb } from "./world/orb";
import { createSea, type Sea } from "./world/sea";
import { createDust, type Dust } from "./world/dust";
import { createFlame, type Flame } from "./world/flame";
import { createRings, type Rings } from "./world/rings";
import { accentColor, seaPalette, toNdc } from "./world/palette";
import { frameLerp, useMotionScale } from "./world/motion";
import "./world.css";

/**
 * The world: one dot sphere, one ripple sea, one bloom pass.
 *
 * This file owns the scene graph and the render loop; everything reusable lives
 * in `./world/*` (constants, shaders, geometry, palette, motion). The composition
 * is fixed on purpose — a single orb above a sea, camera at (0, 0.8, 5.5), bloom
 * (0.28, 0.55, 0). All the chrome in the app floats on top of it.
 *
 * Fallbacks, in order:
 *   1. no WebGL2/WebGL          → CSS orb + CSS horizon, no canvas at all
 *   2. context lost > 1 s       → same CSS fallback, canvas removed
 *   3. reduced motion           → same scene, time scaled to 0.15
 */

interface Props {
  agent: AgentRecord | undefined;
  accent: string;
  reducedMotion: boolean;
  /** Settings → Preferences → Look. Applied to the live scene, not the CSS fallback. */
  look?: { quality: "low" | "balanced" | "high"; bloom: boolean; drift: boolean };
}

const DEFAULT_LOOK: NonNullable<Props["look"]> = { quality: "balanced", bloom: true, drift: true };

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function World({ agent, accent, reducedMotion, look }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<Orb | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const lookRef = useRef<NonNullable<Props["look"]>>(look ?? DEFAULT_LOOK);
  lookRef.current = look ?? DEFAULT_LOOK;
  const [supported] = useState(canUseWebGL);
  const [lost, setLost] = useState(false);
  const motionScale = useMotionScale(reducedMotion);
  const calmRef = useRef(motionScale);
  const stateRef = useRef<AgentState>(agent?.state ?? "idle");
  const accentRef = useRef(accent);
  const idRef = useRef(agent?.id ?? "");
  const seaRef = useRef<Sea | null>(null);
  const flameRef = useRef<Flame | null>(null);
  const ringsRef = useRef<Rings | null>(null);

  calmRef.current = motionScale;

  // The toggle is live: flipping Bloom in Settings changes this scene without a
  // reload, because the pass is kept in a ref instead of rebuilt.
  useEffect(() => {
    if (bloomRef.current) bloomRef.current.enabled = (look ?? DEFAULT_LOOK).bloom;
  }, [look?.bloom]);

  /* Palette and reveal follow the focused companion without rebuilding the scene. */
  useEffect(() => {
    accentRef.current = accent;
    stateRef.current = agent?.state ?? "idle";
    orbRef.current?.setState(agent?.state ?? "idle", accent);

    const sea = seaPalette(accent);
    seaRef.current?.setPalette(sea.low, sea.high);

    const base = accentColor(accent);
    flameRef.current?.setColors(base.clone().multiplyScalar(0.72), base.clone().lerp(new THREE.Color("#ffffff"), 0.3));
    ringsRef.current?.setColor(base);
  }, [accent, agent?.state]);

  useEffect(() => {
    if (!agent?.id || agent.id === idRef.current) return;
    idRef.current = agent.id;
    orbRef.current?.spawn();
  }, [agent?.id]);

  useEffect(() => {
    if (!supported || lost) return;
    const el = host.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(WORLD.bg);
    // Black fog reaching full at 15 units: the sea dissolves into the page.
    scene.fog = new THREE.Fog(0x000000, 0, 15);

    const camera = new THREE.PerspectiveCamera(WORLD.camera.fov, 1, WORLD.camera.near, WORLD.camera.far);
    camera.position.set(...WORLD.camera.position);
    camera.lookAt(...WORLD.camera.lookAt);

    // Render quality is a pixel-ratio ceiling: Low is one device pixel per CSS
    // pixel, Balanced caps at 1.5, High takes whatever the display offers.
    const cap = lookRef.current.quality === "low" ? 1 : lookRef.current.quality === "high" ? 2 : 1.5;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, cap));

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: dpr >= 1.5,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setLost(true);
      return;
    }

    renderer.setPixelRatio(dpr);
    renderer.setClearColor(WORLD.bg, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const orb = createOrb(accentRef.current, stateRef.current);
    orbRef.current = orb;
    orb.spawn();
    scene.add(orb.group);

    const rings = createRings(accentColor(accentRef.current));
    ringsRef.current = rings;
    scene.add(rings.group);

    const seaColors = seaPalette(accentRef.current);
    const sea: Sea = createSea(seaColors.low, seaColors.high);
    seaRef.current = sea;
    scene.add(sea.points);

    const dust: Dust = createDust();
    scene.add(dust.points);

    // Only the sea and the orb need light for the halo; the points are emissive.
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      WORLD.bloom.strength,
      WORLD.bloom.radius,
      WORLD.bloom.threshold,
    );
    bloom.enabled = lookRef.current.bloom;
    bloomRef.current = bloom;
    composer.addPass(bloom);

    /* The flame composited after bloom, exactly where the reference puts it. */
    const flame = createFlame();
    flameRef.current = flame;
    const seaBase = seaPalette(accentRef.current);
    flame.setColors(seaBase.low, seaBase.high);
    flame.pass.uniforms.uFlameAmt.value = WORLD.flame.amount;
    flame.pass.uniforms.uGain.value = WORLD.flame.gain;
    composer.addPass(flame.pass);

    /* ---- pointer ---- */

    const aim = new THREE.Vector2(0, 0);
    const lean = new THREE.Vector2(0, 0);
    const pointer = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WORLD.sea.cursor.planeY);
    const cursorHit = new THREE.Vector3();
    let hasPointer = false;

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(event.clientX - rect.left, event.clientY - rect.top);
      const ndc = toNdc(pointer.x, pointer.y, rect.width, rect.height);
      aim.set(ndc.x, ndc.y);
      hasPointer = true;
    };
    const onLeave = () => {
      // The reference keeps its last pointer target; only activity stops.
      hasPointer = false;
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    /* ---- sizing ---- */

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      orb.material.uniforms.uPixel.value = dpr;
      dust.setSize(w, h, dpr);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(el);

    /* ---- context loss ---- */

    let graceTimer = 0;
    const onLost = (event: Event) => {
      event.preventDefault();
      graceTimer = window.setTimeout(() => setLost(true), WORLD.reduced.contextGraceMs);
    };
    const onRestored = () => window.clearTimeout(graceTimer);
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.domElement.addEventListener("webglcontextrestored", onRestored);

    /* ---- loop ---- */

    const clock = new THREE.Clock();
    const orbNdc = new THREE.Vector2(0, 0.2);
    let orbRadius = 0.25;
    let raf = 0;
    /** Ambient clock. Stops dead under reduced motion; transitions still run on dt. */
    let worldTime = 0;
    let frames = 0;

    const orbWorld = new THREE.Vector3(0, 0, 0);
    const edge = new THREE.Vector3();
    const screen = new THREE.Vector2();
    const cursorTarget = new THREE.Vector3();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, clock.getDelta());
      // Read-only runtime probe: lets a test prove the loop is ticking and the
      // orb is turning, instead of inferring motion from a screenshot pair.
      frames += 1;
      (window as unknown as { __vivWorld?: unknown }).__vivWorld = {
        frames,
        time: worldTime,
        rotation: orb.group.rotation.y,
        scale: orb.group.scale.x,
      };
      const motion = calmRef.current;
      // Ambient drift off means the world only moves while she is working.
      const idle = stateRef.current === "idle";
      const moving = lookRef.current.drift || !idle ? motion : 0;
      worldTime += dt * moving;

      // Camera parallax: the reference lerps 0.06 per frame at 60 fps, with
      // amplitude 0.35 x and 0.105 y, and leads by half on x only.
      const leanK = frameLerp(WORLD.parallax, dt);
      lean.x += (aim.x * WORLD.parallaxRange.x * motion - lean.x) * leanK;
      lean.y += (aim.y * WORLD.parallaxRange.y * motion - lean.y) * leanK;
      camera.position.x = lean.x;
      camera.position.y = WORLD.camera.position[1] + lean.y;
      camera.lookAt(WORLD.camera.lookAt[0] + lean.x * WORLD.lookAhead, WORLD.camera.lookAt[1], 0);

      orb.update(worldTime, dt, moving);
      rings.update(worldTime, dt, moving, stateRef.current === "thinking" ? 1 : 0);
      orbWorld.set(0, 0, 0).project(camera);
      orbNdc.set(orbWorld.x, orbWorld.y);
      edge.set(WORLD.orb.radius, 0, 0).project(camera);
      orbRadius = Math.max(0.02, Math.abs(edge.x - orbWorld.x));

      let cursor: THREE.Vector3 | null = null;
      if (hasPointer) {
        const rect = el.getBoundingClientRect();
        const ndc = toNdc(pointer.x, pointer.y, rect.width, rect.height);
        screen.set(ndc.x, ndc.y);
        raycaster.setFromCamera(screen, camera);
        if (raycaster.ray.intersectPlane(plane, cursorHit)) {
          cursorTarget.copy(cursorHit);
          cursor = cursorTarget;
        }
      }

      sea.update({
        time: worldTime,
        dt,
        motion: moving,
        cursor,
        activity: hasPointer ? 1 : 0,
        orbNdc,
        orbRadius,
        aspect: camera.aspect,
        pixelRatio: dpr,
      });

      dust.update(worldTime, camera);
      flame.update(worldTime);
      composer.render();
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(graceTimer);
      observer.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
      orbRef.current = null;
      bloomRef.current = null;
      seaRef.current = null;
      flameRef.current = null;
      ringsRef.current = null;
      orb.dispose();
      rings.dispose();
      sea.dispose();
      dust.dispose();
      flame.dispose();
      composer.dispose();
      bloom.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
    // A quality change rebuilds the renderer once; bloom and drift are live.
  }, [supported, lost, look?.quality]);

  if (!supported || lost) {
    return (
      <div className="world world--fallback" aria-label={agent ? `${agent.name}, standing in the world` : "the world"}>
        <div className="world-static-sea" aria-hidden />
        <div className="world-static-orb" aria-hidden>
          <span className="world-orb-core" />
          <span className="world-orb-ring" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="world"
      ref={host}
      aria-label={agent ? `${agent.name}, standing in the world` : "the world"}
    />
  );
}
