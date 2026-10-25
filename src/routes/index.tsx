import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { CircuitField } from "@/components/landing/circuit-field";

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
  { label: "Approval gate", tone: "landing-pill--amber", place: "right-[4%] top-[17%]", delay: "1.4s" },
  { label: "Pantry in sync", tone: "landing-pill--blue", place: "left-[46%] bottom-[17%]", delay: "2.6s" },
];

function Landing() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <div aria-hidden className="landing-haze" />

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/55 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:grid md:grid-cols-[1fr_auto_1fr]">
          <nav aria-label="Page sections" className="hidden items-center gap-7 text-[13px] text-muted-foreground md:flex">
            <a href="#about" className="transition-colors hover:text-foreground">
              About
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              How it works
            </a>
          </nav>

          <Link to="/" className="flex items-center gap-2.5 rounded-lg md:justify-self-center" aria-label="Cooksy home">
            <img src="/cooksy-mark.png" alt="" className="size-6 rounded-full object-contain ring-1 ring-primary/25" />
            <span className="text-[15px] font-semibold tracking-tight">Cooksy</span>
          </Link>

          <div className="flex items-center gap-3 md:justify-self-end">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 sm:inline">Beta</span>
            <Link to="/console" className="btn-light btn-light--sm">
              Start the beta
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10">
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
              Cooksy reads what you actually have, drafts the week and writes the shopping list — by voice. Every change
              waits for your approval.
            </p>

            <div className="landing-in landing-in-4 mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
              <Link to="/console" className="btn-light">
                Start the beta version
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a href="#how-it-works" className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
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
        <section id="about" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24 pt-20 sm:pb-32 sm:pt-28">
          <p className="dc-label reveal">About</p>

          <div className="mt-6 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <h2 className="reveal text-[clamp(1.9rem,4.2vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
              Two agents,
              <br />
              <span className="text-foreground/45">one kitchen.</span>
            </h2>

            <div className="reveal space-y-5 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                Cook reads the state of your kitchen — the pantry, what is running low, what is already planned. It answers
                from your data, not from a generic recipe book.
              </p>
              <p>
                Planner takes that picture and proposes the change: the meal, the swap, the shopping list that closes the
                gap. It drafts. It does not write.
              </p>
              <p>
                The console is the whole product. <span className="text-foreground/90">Talk</span> to ask,{" "}
                <span className="text-foreground/90">Kitchen</span> to see the current state,{" "}
                <span className="text-foreground/90">Run</span> to review what is waiting for you.
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
        <section id="how-it-works" className="scroll-mt-16 border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pb-32 sm:pt-28">
            <p className="dc-label reveal">How it works</p>

            <h2 className="reveal mt-6 max-w-2xl text-[clamp(1.9rem,4.2vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
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
                  <p className="max-w-xl text-[14px] leading-relaxed text-muted-foreground">{step.body}</p>
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

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-9 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2.5">
            <img src="/cooksy-mark.png" alt="" aria-hidden className="size-6 rounded-full object-contain ring-1 ring-primary/20" />
            <span className="text-[13px] font-semibold">Cooksy</span>
            <span className="text-[11px] text-muted-foreground/70">© 2026 Doha Mastour</span>
          </div>
          <nav aria-label="Footer" className="flex items-center gap-5 text-[12px] text-muted-foreground">
            <a href="#about" className="transition-colors hover:text-foreground">
              About
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <Link to="/console" className="transition-colors hover:text-foreground">
              Console
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
