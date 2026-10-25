import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type NoticeTone = "success" | "info" | "warn" | "error";

export type Notice = {
  id: number;
  tone: NoticeTone;
  message: string;
};

/** How long a success or info notice stays before it dismisses itself. */
const AUTO_DISMISS_MS = 6000;
/** Matches the exit transition in the notice-shell utility. */
const EXIT_MS = 220;

const TONE: Record<
  NoticeTone,
  { icon: typeof Info; chip: string; border: string; label: string; live: "status" | "alert" }
> = {
  success: {
    icon: CheckCircle2,
    chip: "bg-primary/15 text-primary",
    border: "border-primary/30",
    label: "Done",
    live: "status",
  },
  info: {
    icon: Info,
    chip: "bg-white/[0.07] text-foreground/80",
    border: "border-white/[0.12]",
    label: "Note",
    live: "status",
  },
  warn: {
    icon: AlertTriangle,
    chip: "bg-severity-medium/15 text-severity-medium",
    border: "border-severity-medium/30",
    label: "Heads up",
    live: "alert",
  },
  error: {
    icon: XCircle,
    chip: "bg-destructive/15 text-destructive",
    border: "border-destructive/35",
    label: "Failed",
    live: "alert",
  },
};

/**
 * One notice at a time, above the composer.
 *
 * The tone decides the colour and the announcement: a successful approval must
 * not look like a failure, so the icon and the tint carry the meaning and the
 * message only has to carry the words. Warnings and failures wait for the
 * operator; confirmations dismiss themselves, pausing while hovered or focused.
 */
export function NoticeBar({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  // The last notice is held for one exit animation after the parent clears it.
  const [held, setHeld] = useState<Notice | null>(notice);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const timer = useRef({ id: -1, remaining: AUTO_DISMISS_MS, startedAt: 0 });

  useEffect(() => {
    if (notice) {
      setHeld(notice);
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    setPaused(false);
    const timeout = window.setTimeout(() => setHeld(null), EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!notice) return;
    if (notice.id !== timer.current.id) {
      timer.current = { id: notice.id, remaining: AUTO_DISMISS_MS, startedAt: 0 };
    }
    if (notice.tone === "warn" || notice.tone === "error") return;
    if (paused) return;
    timer.current.startedAt = Date.now();
    const timeout = window.setTimeout(onDismiss, timer.current.remaining);
    return () => {
      window.clearTimeout(timeout);
      timer.current.remaining = Math.max(
        0,
        timer.current.remaining - (Date.now() - timer.current.startedAt),
      );
    };
  }, [notice, paused, onDismiss]);

  if (!held) return null;

  const tone = TONE[held.tone];
  const Icon = tone.icon;
  const timed = held.tone === "success" || held.tone === "info";

  return (
    <div className="notice-shell mt-3" data-open={open ? "true" : "false"}>
      <div>
        <div
          role={tone.live}
          aria-live={tone.live === "alert" ? "assertive" : "polite"}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className={`flex items-start gap-2.5 rounded-2xl border bg-black/25 p-2.5 backdrop-blur-md ${tone.border}`}
        >
          <span
            className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${tone.chip}`}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 pt-0.5 text-xs leading-relaxed text-foreground">
            <span className="sr-only">{tone.label}: </span>
            {held.message}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-my-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
        {timed && (
          <span
            aria-hidden
            className="mt-1 block h-px overflow-hidden rounded-full bg-white/[0.06]"
          >
            <span
              key={held.id}
              className="notice-progress block h-full bg-primary/60"
              style={{ animationPlayState: paused ? "paused" : "running" }}
            />
          </span>
        )}
      </div>
    </div>
  );
}
