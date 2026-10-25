/**
 * The two WebGL surfaces the console uses, in one lazily-loaded chunk.
 *
 * Everything here is decoration: no state, no data, no interaction. That is why
 * it is safe to skip entirely when the browser cannot give us a context — the
 * caller renders a CSS fallback and the console behaves exactly the same.
 *
 * Budget: ~1100 points total, two draw calls, device pixel ratio capped at 1.5,
 * animation stopped when the tab is hidden, and every GPU resource disposed on
 * unmount. Under `prefers-reduced-motion` each surface draws a single static
 * frame instead of starting a loop.
 */
import * as THREE from "three";

type Handle = { dispose: () => void };

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Resolves the live accent to sRGB floats.
 *
 * The design tokens are oklch, which three.js cannot parse, so the browser is
 * asked to paint one pixel and the result is read back. That keeps the field in
 * step with the accent instead of hard-coding orange in a shader.
 */
function accentColor(): [number, number, number] {
  const fallback: [number, number, number] = [1, 0.6, 0.24];
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dc-ember").trim();
  if (!raw) return fallback;
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = "#000";
    ctx.fillStyle = raw;
    // Unparseable values leave the fill untouched, which is the signal to bail.
    if (ctx.fillStyle === "#000000") return fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255];
  } catch {
    return fallback;
  }
}

const DOT_VERTEX = `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vFade;

  void main() {
    vec3 p = position;
    // Drift upward, wrapping at the top so the field never runs out.
    p.y = mod(p.y + uTime * (0.012 + aPhase * 0.006) + 1.0, 2.0) - 1.0;
    p.x += sin(uTime * 0.22 + aPhase) * 0.015;
    vFade = 1.0 - smoothstep(0.5, 1.0, abs(p.y));
    gl_Position = vec4(p.xy, 0.0, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;

const DOT_FRAGMENT = `
  uniform vec3 uColor;
  varying float vFade;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(uColor, a * vFade * 0.45);
  }
`;

/** Slow ember haze behind the whole console. */
export function mountEmberField(canvas: HTMLCanvasElement): Handle {
  const reduced = reducedMotion();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const COUNT = 900;
  const positions = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = Math.random() * 2 - 1;
    positions[i * 3 + 1] = Math.random() * 2 - 1;
    positions[i * 3 + 2] = 0;
    sizes[i] = 1.1 + Math.random() * 3.2;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const [r, g, b] = accentColor();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uColor: { value: new THREE.Color(r, g, b) },
    },
    vertexShader: DOT_VERTEX,
    fragmentShader: DOT_FRAGMENT,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
  };
  resize();
  window.addEventListener("resize", resize);

  const start = performance.now();
  let frame = 0;

  const draw = (seconds: number) => {
    material.uniforms["uTime"]!.value = seconds;
    renderer.render(scene, camera);
  };

  const tick = () => {
    frame = requestAnimationFrame(tick);
    draw((performance.now() - start) / 1000);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!reduced && !frame) {
      tick();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (reduced) draw(0);
  else tick();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

const ORB_VERTEX = `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPixelRatio;
  varying float vFade;

  void main() {
    float angle = atan(position.y, position.x) + uTime * 0.28;
    float radius = length(position.xy) * (1.0 + uLevel * 0.24);
    radius += sin(uTime * 1.7 + aPhase) * 0.018 * (0.35 + uLevel);
    vec2 p = vec2(cos(angle), sin(angle)) * radius;
    p.y *= 0.94;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = aSize * uPixelRatio * (1.0 + uLevel * 0.55);
    vFade = 0.4 + 0.6 * (0.5 + 0.5 * sin(aPhase + uTime * 0.9));
  }
`;

const ORB_FRAGMENT = `
  uniform vec3 uColor;
  varying float vFade;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vFade * 0.9);
  }
`;

/**
 * The ring around the microphone: ember points that widen with your voice.
 *
 * `getLevel` is polled per frame rather than passed as a prop so a running loop
 * never re-renders React.
 */
export function mountVoiceOrb(
  canvas: HTMLCanvasElement,
  getLevel: () => number,
  options: { points?: number } = {},
): Handle {
  const reduced = reducedMotion();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const COUNT = options.points ?? 220;
  const positions = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    // Two rings so the bloom has depth instead of one flat circle of dots.
    const inner = i % 3 === 0;
    const radius = inner ? 0.74 : 0.86 + Math.random() * 0.1;
    const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.05;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius;
    positions[i * 3 + 2] = 0;
    sizes[i] = inner ? 1.2 + Math.random() * 1.4 : 1.6 + Math.random() * 2.2;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const [r, g, b] = accentColor();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uColor: { value: new THREE.Color(r, g, b) },
    },
    vertexShader: ORB_VERTEX,
    fragmentShader: ORB_FRAGMENT,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const resize = () => {
    const width = canvas.clientWidth || 64;
    const height = canvas.clientHeight || 64;
    renderer.setSize(width, height, false);
  };
  resize();

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const start = performance.now();
  let frame = 0;
  let visible = true;
  let level = 0;

  const draw = (seconds: number) => {
    material.uniforms["uTime"]!.value = seconds;
    material.uniforms["uLevel"]!.value = level;
    renderer.render(scene, camera);
  };

  const tick = () => {
    frame = requestAnimationFrame(tick);
    // Ease toward the measured level so the ring breathes instead of twitching.
    level += (Math.max(0, Math.min(1, getLevel())) - level) * 0.12;
    draw((performance.now() - start) / 1000);
  };

  const startLoop = () => {
    if (reduced || frame || !visible || document.hidden) return;
    tick();
  };
  const stopLoop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onVisibility = () => {
    if (document.hidden) stopLoop();
    else startLoop();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Hidden views unmount their canvases, but a tab switch does not, so the
  // intersection check keeps an off-screen orb from burning a frame budget.
  const intersection = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) startLoop();
      else stopLoop();
    },
    { threshold: 0 },
  );
  intersection.observe(canvas);

  if (reduced) draw(0);
  else startLoop();

  return {
    dispose() {
      stopLoop();
      intersection.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
