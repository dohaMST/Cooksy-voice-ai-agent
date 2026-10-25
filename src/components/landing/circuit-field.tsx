import { useEffect, useRef } from "react";

type Pt = { x: number; y: number };
type Bucket = { a: number; path: Path2D };
type Pad = { x: number; y: number; r: number; a: number; p: number };
type Wire = { pts: Pt[]; len: number };

const TAU = Math.PI * 2;

/**
 * The circuit field behind the landing hero.
 *
 * The mark is a pot wired into a board: horizontal traces, 45-degree elbows and
 * round pads. Scaled up and faded out, that is the background — the brand's own
 * geometry rather than a generic dot grid.
 *
 * Drawn on a 2D canvas, not in WebGL: a few hundred path segments per frame are
 * cheaper than a 517 kB three.js chunk, and the geometry is built once per
 * resize, never per frame. Traces are grouped into six alpha buckets at build
 * time, so a frame is six `stroke()` calls plus the pads instead of one per
 * segment.
 *
 * Decoration only: `aria-hidden`, no pointer events, paused off-screen and on a
 * hidden tab, and a single static frame when the visitor asked for reduced
 * motion.
 */
export function CircuitField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let buckets: Bucket[] = [];
    let pads: Pad[] = [];
    let wires: Wire[] = [];
    let width = 1;
    let height = 1;
    let cx = 0;
    let cy = 0;
    let frame = 0;
    let running = false;
    let started = 0;

    /* Canvas serialises any CSS colour it understands, so the field follows the
       live accent instead of hard-coding the ember. */
    const probe = document.createElement("canvas").getContext("2d");
    const rgb = (() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--dc-ember").trim();
      if (!probe) return "242, 166, 90";
      probe.fillStyle = "#000000";
      probe.fillStyle = raw || "#000000";
      const hex = String(probe.fillStyle);
      const match = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!match) return "242, 166, 90";
      const n = parseInt(match[1] ?? "", 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    })();

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cx = width * 0.5;
      cy = height * 0.62;

      /* Seeded so a resize reshuffles the field the same way every time, and a
         reload never lands on a different composition. */
      let seed = 20261025;
      const rnd = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      const s = Math.max(0.6, Math.min(1.5, Math.min(width / 1180, height / 720)));
      const rows = Math.max(9, Math.min(22, Math.round(height / (34 * s))));
      const gap = (height * 0.74) / rows;
      const reach = Math.max(width * 0.52, 340 * s);
      const top = height * 0.08;
      const bottom = height * 0.94;

      /* Soft radial falloff: the board is dense behind the headline and gone at
         the edges, so the stage never reads as a tiled texture. */
      const fade = (x: number, y: number) => {
        const u = (x - cx) / (width * 0.52);
        const v = (y - cy) / (height * 0.62);
        return Math.exp(-1.25 * (u * u + v * v));
      };

      const segs: { a: number; x1: number; y1: number; x2: number; y2: number }[] = [];
      const nextPads: Pad[] = [];
      const nextWires: Wire[] = [];

      for (let i = 0; i < rows; i++) {
        const baseY = cy + (i - (rows - 1) / 2) * gap + (rnd() - 0.5) * gap * 0.3;

        /* Each row sends a trace out to the left and to the right of the mark,
           the way the logo's pads sit on both sides of the pot. */
        for (const side of [-1, 1]) {
          if (rnd() < 0.16) continue;

          let x = cx + side * (14 + rnd() * 44) * s;
          let y = baseY;
          const pts: Pt[] = [{ x, y }];
          const budget = reach * (0.4 + rnd() * 0.66);
          let travelled = 0;

          for (let guard = 0; travelled < budget && guard < 7; guard++) {
            if (rnd() < 0.55) {
              const jog = (rnd() < 0.5 ? -1 : 1) * (9 + rnd() * 26) * s;
              const ny = Math.min(bottom, Math.max(top, y + jog));
              /* A 45-degree elbow: x and y move by the same amount. */
              x += side * Math.abs(ny - y);
              y = ny;
              pts.push({ x, y });
              travelled += Math.abs(jog) * 1.6;
            }

            const run = (30 + rnd() * 120) * s;
            x += side * run;
            pts.push({ x, y });
            travelled += run;
          }

          for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1]!;
            const b = pts[k]!;
            const alpha = fade((a.x + b.x) / 2, (a.y + b.y) / 2);
            if (alpha < 0.04) continue;
            segs.push({ a: alpha, x1: a.x, y1: a.y, x2: b.x, y2: b.y });

            /* Occasional via on an elbow. */
            if (rnd() < 0.14) {
              nextPads.push({ x: b.x, y: b.y, r: (1.5 + rnd() * 1.2) * s, a: alpha * 0.85, p: rnd() * TAU });
            }
          }

          const end = pts[pts.length - 1]!;
          const endA = fade(end.x, end.y);
          if (endA > 0.12) {
            nextPads.push({ x: end.x, y: end.y, r: (2.4 + rnd() * 1.8) * s, a: endA, p: rnd() * TAU });
            let len = 0;
            for (let k = 1; k < pts.length; k++) {
              const a = pts[k - 1]!;
              const b = pts[k]!;
              len += Math.hypot(b.x - a.x, b.y - a.y);
            }
            nextWires.push({ pts, len });
          }
        }
      }

      const groups = new Map<number, Path2D>();
      for (const seg of segs) {
        const key = Math.min(5, Math.max(0, Math.round(seg.a * 5)));
        let path = groups.get(key);
        if (!path) {
          path = new Path2D();
          groups.set(key, path);
        }
        path.moveTo(seg.x1, seg.y1);
        path.lineTo(seg.x2, seg.y2);
      }

      buckets = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, path]) => ({ a: key / 5, path }));
      pads = nextPads;
      wires = nextWires;
    };

    const paint = (now: number) => {
      const t = (now - started) / 1000;
      const still = reduce.matches;

      ctx.clearRect(0, 0, width, height);

      const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.62);
      bloom.addColorStop(0, `rgba(${rgb}, 0.26)`);
      bloom.addColorStop(0.42, `rgba(${rgb}, 0.07)`);
      bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);

      /* The badge itself, traced faintly: two rings and the wifi arcs above the
         pot, so the field reads as the mark blown up rather than as wallpaper. */
      const radius = Math.min(width * 0.46, height * 0.5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb}, 0.09)`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.62, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${rgb}, 0.13)`;
      ctx.beginPath();
      ctx.arc(cx, cy - radius * 0.34, radius * 0.42, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - radius * 0.34, radius * 0.26, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();

      const dx = still ? 0 : Math.sin(t * 0.18) * 9;
      const dy = still ? 0 : Math.cos(t * 0.13) * 5;

      ctx.save();
      ctx.translate(dx, dy);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgb(${rgb})`;

      for (const bucket of buckets) {
        const shimmer = still ? 1 : 0.78 + 0.22 * Math.sin(t * 0.7 + bucket.a * 3.1);
        ctx.globalAlpha = Math.min(1, bucket.a * 0.62 * shimmer);
        if (ctx.globalAlpha < 0.02) continue;
        ctx.stroke(bucket.path);
      }

      ctx.fillStyle = `rgb(${rgb})`;
      for (const pad of pads) {
        const pulse = still ? 0.8 : 0.55 + 0.45 * Math.sin(t * 1.5 + pad.p);
        ctx.globalAlpha = pad.a * 0.9 * pulse;
        if (ctx.globalAlpha < 0.02) continue;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, pad.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* One signal per cycle walks the board, so the field is alive without the
         whole composition sliding around. The index is clamped: a clock that
         steps backwards (dev tools virtual time, a throttled frame) would
         otherwise produce a negative index and read past the array. */
      if (!still && wires.length > 0) {
        const cycle = 4.6;
        const count = wires.length;
        const step = Math.floor(t / cycle);
        const wire = wires[((step % count) + count) % count];
        if (wire) {
          const target = (t % cycle) / cycle * wire.len;
          let acc = 0;
          let sx = wire.pts[0]!.x;
          let sy = wire.pts[0]!.y;

          for (let k = 1; k < wire.pts.length; k++) {
            const a = wire.pts[k - 1]!;
            const b = wire.pts[k]!;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (acc + d >= target) {
              const f = d === 0 ? 0 : (target - acc) / d;
              sx = a.x + (b.x - a.x) * f;
              sy = a.y + (b.y - a.y) * f;
              break;
            }
            acc += d;
            sx = b.x;
            sy = b.y;
          }

          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
          glow.addColorStop(0, `rgba(${rgb}, 0.55)`);
          glow.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, 14, 0, TAU);
          ctx.fill();

          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.beginPath();
          ctx.arc(sx, sy, 1.4, 0, TAU);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    const loop = (now: number) => {
      paint(now);
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running) return;
      running = true;
      started = performance.now();
      if (reduce.matches) {
        paint(started);
        running = false;
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    build();
    started = performance.now();
    /* Always paint one frame: the canvas is cleared by the resize in build(),
       and the observer that starts the loop is asynchronous, so without this
       the stage can flash empty on first load and on every resize. */
    paint(started);

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      },
      { rootMargin: "120px" },
    );
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      build();
      paint(performance.now());
    });
    ro.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onMotion = () => {
      stop();
      started = performance.now();
      paint(started);
      if (!reduce.matches) start();
    };
    reduce.addEventListener("change", onMotion);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onMotion);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
