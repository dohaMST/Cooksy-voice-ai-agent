import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUp } from "lucide-react";

import { CircuitField } from "@/components/landing/circuit-field";
import { useLandingScroll } from "@/hooks/use-landing-scroll";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cooksy — talk to your kitchen" },
      {
        name: "description",
        content:
          "Cooksy is a voice console for your kitchen: ask about the pantry, let Planner draft the week, and approve every change before it is written.",
      },
      { property: "og:title", content: "Cooksy — talk to your kitchen" },
      {
        property: "og:description",
        content:
          "A voice console for a kitchen: pantry, week plan and shopping list, with every change gated by your approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    title: "Speak, or type",
    body: "Hold the mic and ask, or write it. The turn goes to the agent you picked — Cook unless you say otherwise.",
  },
  {
    title: "Cook reads the kitchen",
    body: "Pantry, week plan and shopping list come back from the store, so the answer is about your food rather than a generic recipe.",
  },
  {
    title: "Planner drafts the change",
    body: "What to add, swap or drop, with the reason attached — as a proposal, never as an edit.",
  },
  {
    title: "You approve it",
    body: "Approve and the change is written. Deny and nothing moves. That gate is the product, not a setting.",
  },
];

const FACTS = [
  { label: "Agents", value: "Two" },
  { label: "Views", value: "Three" },
  { label: "Silent writes", value: "None" },
];

const PILLS = [
  { label: "Voice first", tone: "landing-pill--ember", place: "left-[5%] top-[26%]", delay: "0s" },
  {
    label: "Approval gate",
    tone: "landing-pill--amber",
    place: "right-[4%] top-[17%]",
    delay: "1.4s",
  },
  {
    label: "Pantry in sync",
    tone: "landing-pill--blue",
    place: "left-[46%] bottom-[17%]",
    delay: "2.6s",
  },
];

/* Module scope so the ids array keeps one reference: the scroll spy keys its
   observer on it. */
const SECTIONS = [
  { id: "about", label: "About" },
  { id: "how-it-works", label: "How it works" },
] as const;

const SECTION_IDS = SECTIONS.map((section) => section.id);

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
}

/**
 * The hash owns the scroll, so the URL stays shareable and back/forward keep
 * working. This only finishes the job for assistive tech: focus follows the
 * viewport to the section heading without interrupting the glide.
 */
function focusSectionHeading(id: string) {
  const heading = document.getElementById(id)?.querySelector<HTMLElement>("h2");
  if (!heading) return;

  requestAnimationFrame(() => heading.focus({ preventScroll: true }));
}

function Landing() {
  const { activeId, scrolled, showTop } = useLandingScroll(SECTION_IDS);

  return (
    <div className="relative min-h-dvh text-foreground">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          /* Jump, don't glide: a keyboard user asking to skip the nav should not
             sit through the page's smooth-scroll animation. */
          const main = document.getElementById("main");
          if (!main) return;
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: "instant" });
          main.focus({ preventScroll: true });
        }}
      >
        Skip to content
      </a>

      <div aria-hidden className="landing-haze" />

      <header
        data-scrolled={scrolled ? "true" : "false"}
        className="site-header fixed inset-x-0 top-0 z-40"
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 md:grid md:grid-cols-[1fr_auto_1fr]">
          <nav aria-label="Page sections" className="flex min-w-0 items-center gap-3 md:gap-7">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="nav-link"
                aria-current={activeId === section.id ? "true" : undefined}
                onClick={() => focusSectionHeading(section.id)}
              >
                {section.label}
              </a>
            ))}
          </nav>

          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 rounded-lg md:justify-self-center"
            aria-label="Cooksy home"
            onClick={scrollToTop}
          >
            <img
              src="/cooksy-mark.png"
              alt=""
              className="size-6 rounded-full object-contain ring-1 ring-primary/25"
            />
            <span className="hidden text-[15px] font-semibold tracking-tight min-[360px]:inline">
              Cooksy
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-3 md:justify-self-end">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 sm:inline">
              Beta
            </span>
            <Link to="/console" className="btn-light btn-light--sm">
              <span className="hidden sm:inline">Start the beta</span>
              <span className="sm:hidden">Try beta</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="relative z-10 outline-none">
        {/* One stage: the headline lives inside the board as its backdrop, the
            circuit field moves over it, the real heading stays crisp on top. */}
        <section className="landing-stage">
          <div aria-hidden className="landing-watermark">
            <span>Talk to your kitchen.</span>
            <span>Keep the final say.</span>
          </div>

          <CircuitField className="landing-field absolute inset-0 z-0 h-full w-full" />

          <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-5 text-center">
            <p className="landing-eyebrow landing-in landing-in-1">
              <i aria-hidden />
              Voice console · Beta
            </p>

            <h1 className="landing-in landing-in-2 mt-6 text-[clamp(1.9rem,8vw,4.35rem)] font-semibold leading-[0.98] tracking-[-0.035em]">
              Talk to your kitchen.
              <br />
              <span className="text-foreground/45">Keep the final say.</span>
            </h1>

            <p className="landing-in landing-in-3 mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground sm:text-base">
              Cooksy reads what you actually have, drafts the week and writes the shopping list — by
              voice. Every change waits for your approval.
            </p>

            <div className="landing-in landing-in-4 mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
              <Link to="/console" className="btn-light">
                Start the beta version
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a
                href="#how-it-works"
                className="py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => focusSectionHeading("how-it-works")}
              >
                See how it works
              </a>
            </div>

            <ul className="landing-in landing-in-4 mt-10 flex flex-wrap items-center justify-center gap-2 xl:hidden">
              {PILLS.map((pill) => (
                <li key={pill.label} className={`landing-pill ${pill.tone}`}>
                  <i />
                  {pill.label}
                </li>
              ))}
            </ul>
          </div>

          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden xl:block">
            {PILLS.map((pill) => (
              <span
                key={pill.label}
                className={`landing-pill landing-pill--float ${pill.tone} absolute ${pill.place}`}
                style={{ animationDelay: pill.delay }}
              >
                <i />
                {pill.label}
              </span>
            ))}
          </div>
        </section>

        {/* About */}
        <section id="about" className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pb-32 sm:pt-28">
          <p className="dc-label reveal">About</p>

          <div className="mt-6 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <h2
              tabIndex={-1}
              className="reveal text-[clamp(1.9rem,4.2vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em]"
            >
              Two agents,
              <br />
              <span className="text-foreground/45">one kitchen.</span>
            </h2>

            <div className="reveal space-y-5 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                Cook reads the state of your kitchen — the pantry, what is running low, what is
                already planned. It answers from your data, not from a generic recipe book.
              </p>
              <p>
                Planner takes that picture and proposes the change: the meal, the swap, the shopping
                list that closes the gap. It drafts. It does not write.
              </p>
              <p>
                The console is the whole product. <span className="text-foreground/90">Talk</span>{" "}
                to ask, <span className="text-foreground/90">Kitchen</span> to see the current
                state, <span className="text-foreground/90">Run</span> to review what is waiting for
                you.
              </p>
            </div>
          </div>

          <dl className="panel reveal mt-14 grid grid-cols-3 overflow-hidden sm:mt-20">
            {FACTS.map((fact, index) => (
              <div
                key={fact.label}
                className={`flex flex-col justify-between gap-2 px-4 py-6 sm:px-6 sm:py-7 ${
                  index > 0 ? "border-l border-white/[0.06]" : ""
                }`}
              >
                <dt className="dc-label">{fact.label}</dt>
                <dd className="text-xl font-semibold tracking-tight sm:text-2xl">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pb-32 sm:pt-28">
            <p className="dc-label reveal">How it works</p>

            <h2
              tabIndex={-1}
              className="reveal mt-6 max-w-2xl text-[clamp(1.9rem,4.2vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em]"
            >
              Four steps,
              <br />
              <span className="text-foreground/45">one of them yours.</span>
            </h2>

            <ol className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="panel reveal flex flex-col gap-3 p-6 transition-colors hover:border-white/[0.14] sm:p-7"
                >
                  <span className="font-mono text-[11px] tracking-[0.18em] text-primary/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-lg font-semibold tracking-tight sm:text-xl">{step.title}</h3>
                  <p className="max-w-xl text-[14px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="relative overflow-hidden border-t border-white/[0.06] px-5 py-24 text-center sm:py-32">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-40 mx-auto h-80 w-[min(900px,120%)] rounded-full opacity-70 blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in oklab, var(--dc-ember) 26%, transparent), transparent)",
            }}
          />
          <div className="relative">
            <h2 className="reveal text-[clamp(1.9rem,4.6vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
              Ready when you are.
            </h2>
            <p className="reveal mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              The beta runs on your machine, against your own kitchen data.
            </p>
            <div className="reveal mt-8 flex justify-center">
              <Link to="/console" className="btn-light">
                Start the beta version
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              No account · no cloud sync
            </p>
          </div>
        </section>
      </main>

      {showTop ? (
        <button
          type="button"
          className="scroll-top"
          aria-label="Back to top"
          onClick={() => {
            scrollToTop();
            /* The button unmounts as the page passes the threshold, so focus
               goes somewhere real instead of falling back to the body. */
            document.getElementById("main")?.focus({ preventScroll: true });
          }}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      ) : null}

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-9 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2.5">
            <img
              src="/cooksy-mark.png"
              alt=""
              aria-hidden
              className="size-6 rounded-full object-contain ring-1 ring-primary/20"
            />
            <span className="text-[13px] font-semibold">Cooksy</span>
            <span className="text-[11px] text-muted-foreground/70">© 2026 Doha Mastour</span>
          </div>
          <nav
            aria-label="Footer"
            className="flex items-center gap-5 text-[12px] text-muted-foreground"
          >
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="py-2 transition-colors hover:text-foreground"
                aria-current={activeId === section.id ? "true" : undefined}
                onClick={() => focusSectionHeading(section.id)}
              >
                {section.label}
              </a>
            ))}
            <Link to="/console" className="py-2 transition-colors hover:text-foreground">
              Console
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
