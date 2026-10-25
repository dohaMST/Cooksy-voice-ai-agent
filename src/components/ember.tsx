import { useEffect, useRef } from "react";

type Handle = { dispose: () => void };

/**
 * Both WebGL surfaces load the same chunk on demand, so three.js never enters
 * the initial bundle. A browser without WebGL simply keeps the CSS haze and the
 * CSS ring — the console is fully usable either way.
 */

/** Full-viewport ember haze. Purely decorative, never interactive. */
export function EmberField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: Handle | undefined;
    let cancelled = false;

    void import("@/lib/three/ember-field")
      .then((mod) => {
        if (cancelled || !canvas.isConnected) return;
        try {
          handle = mod.mountEmberField(canvas);
        } catch {
          // No context, or the driver refused one. Decoration only: stay quiet.
        }
      })
      .catch(() => {
        /* chunk failed to load: the CSS haze still carries the page */
      });

    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="ember-canvas" />;
}

/**
 * The ring around the microphone.
 *
 * `level` is read through a ref inside the render loop, so a live microphone
 * drives the ring at 60fps without re-rendering the console.
 */
export function VoiceOrb({ level, active }: { level: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
  levelRef.current = active ? Math.min(1, level * 3.2) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: Handle | undefined;
    let cancelled = false;

    void import("@/lib/three/ember-field")
      .then((mod) => {
        if (cancelled || !canvas.isConnected) return;
        try {
          handle = mod.mountVoiceOrb(canvas, () => levelRef.current);
        } catch {
          /* the CSS ring underneath is the fallback */
        }
      })
      .catch(() => {
        /* chunk failed to load: the CSS ring underneath is the fallback */
      });

    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, []);

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {/* Drawn under the canvas: this is the ring when WebGL is unavailable. */}
      <span
        className={`absolute inset-0 rounded-full border transition-[transform,border-color] duration-200 ${
          active ? "border-primary/50" : "border-primary/15"
        }`}
        style={active ? { transform: `scale(${1 + Math.min(level, 0.4) * 0.4})` } : undefined}
      />
      <canvas ref={canvasRef} className="absolute inset-0 size-full rounded-full" />
    </span>
  );
}
