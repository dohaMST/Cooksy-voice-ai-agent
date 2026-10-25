import { useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  Brain,
  Cpu,
  ListTree,
  Mic,
  Plug,
  RefreshCw,
  Type,
  Volume2,
} from "lucide-react";
import { InlineKeyboard } from "@/components/chat-bubbles";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  NAV_LABEL,
  normalizeText,
  paginate,
  type ActionProposal,
  type Screen,
} from "@/lib/voice/screen";
import { ENGINE_LABEL, getAgents, useVoiceSettings } from "@/lib/settings/voice";
import { useKitchen } from "@/lib/cooksy/console";
import type { ApprovalRecord, PantryItem, PlanEntry, ShoppingItem } from "@/lib/cooksy/types";

export type PanelStage =
  "received" | "transcribing" | "planning" | "thinking" | "streaming" | "speaking" | "error";

/** One active screen: long text is paged in place, and controls never exceed four. */
export function PagedScreen({
  text,
  screen,
  disabled,
  onSend,
}: {
  text: string;
  screen?: Screen | undefined;
  disabled: boolean;
  onSend: (value: string) => void;
}) {
  const pages = paginate(text);
  const [page, setPage] = useState(0);
  const index = Math.min(page, pages.length - 1);
  const last = index === pages.length - 1;

  type Control = {
    key: string;
    label: string;
    primary?: boolean;
    paging?: boolean;
    onClick: () => void;
  };
  const controls: Control[] = [];
  if (index > 0)
    controls.push({
      key: "prev",
      label: "‹ Previous",
      paging: true,
      onClick: () => setPage(index - 1),
    });
  if (!last)
    controls.push({
      key: "next",
      label: "Next ›",
      primary: true,
      paging: true,
      onClick: () => setPage(index + 1),
    });
  if (last && screen) {
    screen.choices.forEach((c) =>
      controls.push({ key: c.id, label: c.label, primary: true, onClick: () => onSend(c.value) }),
    );
    screen.navigation.forEach((n) =>
      controls.push({ key: n, label: NAV_LABEL[n], onClick: () => onSend(NAV_LABEL[n]) }),
    );
  }
  const shown = controls.slice(0, 4);

  return (
    <>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{pages[index]}</p>
      {pages.length > 1 && (
        <p className="dc-label mt-1 text-[10px]">
          Page {index + 1} / {pages.length}
        </p>
      )}
      <InlineKeyboard
        buttons={shown.map((c) => ({
          key: c.key,
          label: c.label,
          onClick: c.onClick,
          disabled: disabled && !c.paging,
        }))}
      />
    </>
  );
}

const PIPELINE: {
  key: string;
  label: string;
  detail: string;
  stages: (PanelStage | "recording")[];
}[] = [
  {
    key: "capture",
    label: "Audio capture",
    detail: "Hold-to-talk microphone",
    stages: ["recording"],
  },
  { key: "asr", label: "Transcribe", detail: "Whisper", stages: ["received", "transcribing"] },
  { key: "plan", label: "Sending", detail: "Turn admitted", stages: ["planning"] },
  { key: "think", label: "Thinking", detail: "Reasoning summary", stages: ["thinking"] },
  { key: "stream", label: "Synthesizing", detail: "Edit-in-place screen", stages: ["streaming"] },
  { key: "speak", label: "Speaking", detail: "Device voice", stages: ["speaking"] },
];

function currentStep(stage: PanelStage | undefined, recording: boolean) {
  if (recording) return 0;
  if (!stage || stage === "error") return -1;
  return PIPELINE.findIndex((step) => step.stages.includes(stage));
}

const STAGE_ICON: Record<string, typeof Mic> = {
  capture: Mic,
  asr: AudioLines,
  plan: ListTree,
  think: Brain,
  stream: Type,
  speak: Volume2,
};

/** Compact live readout of the agent answering right now. */
export function ModelStatusStrip() {
  const [voice] = useVoiceSettings();
  const label = getAgents()[voice.agent]?.label ?? voice.agent;
  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground"
      aria-label="Agent active now"
    >
      <span
        className="flex min-w-0 items-center gap-1.5"
        title="The agent this console is talking to"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        <Cpu aria-hidden className="size-3 shrink-0 text-foreground/70" />
        <span className="truncate text-foreground">{label}</span>
      </span>
      {/* The gateway route is a detail of the Run view; on a phone the strip
          only has room for who is answering. */}
      <span
        className="hidden shrink-0 items-center gap-1 sm:flex"
        title="Gateway route used for this agent"
      >
        <Plug aria-hidden className="size-3 text-foreground/70" />
        <span>openclaw/{voice.agent}</span>
      </span>
    </div>
  );
}

/** Compact lifecycle strip: icons instead of words. */
export function LifecycleStrip({
  stage,
  recording,
}: {
  stage?: PanelStage | undefined;
  recording: boolean;
}) {
  const step = currentStep(stage, recording);
  const [voice] = useVoiceSettings();
  const detail = (key: string) =>
    key === "asr"
      ? voice.asrEngine === "local"
        ? voice.asrModel
        : PIPELINE[1]!.detail
      : key === "speak"
        ? ENGINE_LABEL[voice.engine]
        : (PIPELINE.find((p) => p.key === key)?.detail ?? "");
  return (
    <div className="flex shrink-0 items-end gap-2" aria-label="Lifecycle progress">
      {PIPELINE.map((item, i) => {
        const state = step < 0 ? "idle" : i < step ? "done" : i === step ? "active" : "idle";
        const Icon = STAGE_ICON[item.key]!;
        return (
          <span
            key={item.key}
            title={`${item.label} — ${detail(item.key)}`}
            className="flex flex-col items-center gap-1"
          >
            <Icon
              aria-hidden
              className={`size-3.5 ${state === "active" ? "animate-pulse text-primary" : state === "done" ? "text-foreground/70" : "text-muted-foreground/40"}`}
            />
            <span aria-hidden className="h-0.5 w-4 overflow-hidden rounded-full bg-white/10">
              <span
                className={`block h-full rounded-full transition-all duration-500 ${state === "done" ? "w-full bg-primary/60" : state === "active" ? "w-full animate-pulse bg-primary" : "w-0"}`}
              />
            </span>
          </span>
        );
      })}
      <span className="pb-0.5 font-mono text-[10px] text-muted-foreground">
        {step < 0 ? "—" : `${step + 1}/6`}
      </span>
    </div>
  );
}

/** The thin strip above the conversation: who is answering, and how far along. */
export function RunStrip({
  level,
  active,
  stage,
}: {
  level: number;
  active: boolean;
  stage?: PanelStage | undefined;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] pb-2">
      <ModelStatusStrip />
      <span className="flex shrink-0 items-center gap-[2px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-2 w-[3px] rounded-full transition-colors ${active && level * 5 > i ? "bg-primary" : "bg-white/15"}`}
          />
        ))}
      </span>
      {/* Six lifecycle icons do not fit beside the agent on a phone, and the live
          bubble already narrates the stage there. */}
      <div className="hidden shrink-0 sm:block">
        <LifecycleStrip stage={stage} recording={active} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

const RISK_CLASS: Record<string, string> = {
  high: "text-destructive",
  medium: "text-severity-medium",
  low: "text-muted-foreground",
};

function minutesLeft(expiresAt: number): string {
  const left = Math.max(0, expiresAt - Date.now());
  const minutes = Math.round(left / 60_000);
  return minutes >= 1 ? `${minutes} min left` : "expiring now";
}

/**
 * The approval card, rendered from the stored queue — never from the model's words.
 *
 * When the agent mentions an approval that the queue does not contain, the card
 * says so and offers no buttons. A proposal the operator cannot verify is not
 * actionable, and nothing here can execute without cooksy-api running it.
 */
function ApprovalList({
  pending,
  proposal,
  error,
  busyId,
  disabled,
  onDecide,
}: {
  pending: ApprovalRecord[];
  proposal?: ActionProposal | null | undefined;
  error?: string | null | undefined;
  busyId?: string | null | undefined;
  disabled: boolean;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}) {
  const claimed = proposal
    ? pending.find((row) => row._id === proposal.id && row.tool === proposal.tool)
    : undefined;
  const unknownClaim = Boolean(proposal) && !claimed;

  if (error) {
    return (
      <p
        role="alert"
        className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-destructive"
      >
        <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>{error}</span>
      </p>
    );
  }

  if (!pending.length) {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs leading-relaxed text-muted-foreground">Nothing is waiting for you.</p>
        {unknownClaim && (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-severity-medium">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The agent mentioned a change, but no stored approval matches it. Nothing can be
              approved here.
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className="mt-2 space-y-3">
      {pending.map((row) => (
        <li
          key={row._id}
          className="space-y-2 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold text-foreground">
              {normalizeText(row.title)}
            </p>
            <span
              className={`shrink-0 font-mono text-[10px] ${RISK_CLASS[row.risk] ?? "text-muted-foreground"}`}
            >
              ● {(row.risk ?? "low").toUpperCase()}
            </span>
          </div>
          <p className="break-all font-mono text-[10px] text-primary">Tool · {row.tool}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {normalizeText(row.summary)}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {minutesLeft(row.expiresAt)}
          </p>
          <InlineKeyboard
            buttons={[
              {
                key: `${row._id}-approve`,
                label: "✓ Approve",
                onClick: () => onDecide(row._id, "approve"),
                disabled: disabled || busyId === row._id,
              },
              {
                key: `${row._id}-deny`,
                label: "✕ Deny",
                tone: "danger",
                onClick: () => onDecide(row._id, "deny"),
                disabled: disabled || busyId === row._id,
              },
            ]}
          />
        </li>
      ))}
    </ul>
  );
}

/** The Run view: what is happening now, what is waiting, and where the answer came from. */
export function RunView({
  statusLabel,
  turns,
  pending,
  proposal,
  approvalError,
  busyId,
  disabled = false,
  onDecide,
}: {
  statusLabel: string;
  turns: number;
  pending: ApprovalRecord[];
  proposal?: ActionProposal | null | undefined;
  approvalError?: string | null | undefined;
  busyId?: string | null | undefined;
  disabled?: boolean;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}) {
  const [voice] = useVoiceSettings();
  const agentLabel = getAgents()[voice.agent]?.label ?? voice.agent;

  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="dc-label">Approval</p>
          {pending.length > 0 && (
            <span className="font-mono text-[10px] text-severity-medium">
              ● {pending.length} PENDING
            </span>
          )}
        </div>
        <ApprovalList
          pending={pending}
          proposal={proposal}
          error={approvalError}
          busyId={busyId}
          disabled={disabled}
          onDecide={onDecide}
        />
      </section>

      <div className="space-y-4">
        <section className="panel p-4">
          <p className="dc-label">Current run</p>
          <div className="mt-2">
            <Row label="Status" value={statusLabel} />
            <Row label="Messages" value={String(turns)} />
          </div>
        </section>
        <section className="panel p-4">
          <div className="flex items-center justify-between">
            <p className="dc-label">OpenClaw gateway</p>
            <span className="font-mono text-[10px] text-muted-foreground">127.0.0.1:18789</span>
          </div>
          <div className="mt-2">
            <Row label="Agent" value={agentLabel} />
            <Row label="Route" value={`/api/agent → openclaw/${voice.agent}`} />
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Kitchen                                                                    */
/* -------------------------------------------------------------------------- */

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 py-2">
      <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
        <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>{message}</span>
      </p>
      <Button size="sm" variant="outline" onClick={onRetry} className="h-7 rounded-full text-xs">
        <RefreshCw className="size-3" /> Try again
      </Button>
    </div>
  );
}

function ListMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/**
 * One metric. `null` means "not read yet" and prints an em dash — the console
 * never claims a list is empty before it has actually read it.
 */
function Metric({
  label,
  value,
  unit,
  error,
}: {
  label: string;
  value: number | null;
  unit: string;
  error?: string | null;
}) {
  return (
    <div className="panel flex flex-col gap-1 p-3 sm:p-4">
      <p className="dc-label text-[9px] sm:text-[10px]">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-foreground">
        {value === null ? "—" : value}
      </p>
      <p className="text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
        {error ? "could not be read" : unit}
      </p>
    </div>
  );
}

function PantryList({
  items,
  error,
  refresh,
}: {
  items: PantryItem[] | null;
  error: string | null;
  refresh: () => void;
}) {
  if (error) return <ListError message={error} onRetry={refresh} />;
  if (!items) return <ListMessage>Reading the pantry…</ListMessage>;
  if (!items.length)
    return <ListMessage>The pantry is empty. Ask Cook to add what you have.</ListMessage>;

  const sorted = [...items].sort((a, b) =>
    normalizeText(a.name).localeCompare(normalizeText(b.name)),
  );

  return (
    <ul className="divide-y divide-white/[0.06]">
      {sorted.map((item) => (
        <li key={item._id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">{normalizeText(item.name)}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {item.quantity} {normalizeText(item.unit)}
            {item.bestBefore ? ` · best before ${item.bestBefore}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanList({
  entries,
  error,
  refresh,
}: {
  entries: PlanEntry[] | null;
  error: string | null;
  refresh: () => void;
}) {
  if (error) return <ListError message={error} onRetry={refresh} />;
  if (!entries) return <ListMessage>Reading this week…</ListMessage>;
  if (!entries.length) return <ListMessage>Nothing is planned this week.</ListMessage>;

  const byDate = new Map<string, PlanEntry[]>();
  for (const entry of entries) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);

  const dayName = (date: string) => {
    const parsed = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? date
      : parsed.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  };

  return (
    <ul className="space-y-4">
      {[...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => (
          <li key={date}>
            <p className="dc-label text-primary/80">{dayName(date)}</p>
            <ul className="mt-1.5 space-y-1.5">
              {rows.map((row) => (
                <li key={row._id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">
                    {row.recipeName ? normalizeText(row.recipeName) : "Unknown recipe"}
                  </span>
                  <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {row.meal}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
    </ul>
  );
}

function ShoppingList({
  items,
  error,
  refresh,
}: {
  items: ShoppingItem[] | null;
  error: string | null;
  refresh: () => void;
}) {
  if (error) return <ListError message={error} onRetry={refresh} />;
  if (!items) return <ListMessage>Reading the shopping list…</ListMessage>;
  if (!items.length)
    return <ListMessage>Nothing to buy. Ask Planner to build the list from the week.</ListMessage>;

  return (
    <ul className="divide-y divide-white/[0.06]">
      {items.map((item) => (
        <li key={item._id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              aria-hidden
              className={`grid size-4 shrink-0 place-items-center rounded-full border text-[9px] ${item.checked ? "border-primary/60 bg-primary/15 text-primary" : "border-white/15 text-transparent"}`}
            >
              ✓
            </span>
            <span
              className={`min-w-0 truncate ${item.checked ? "text-muted-foreground line-through" : "text-foreground"}`}
            >
              {normalizeText(item.name)}
            </span>
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {item.quantity} {normalizeText(item.unit)}
            <span className="sr-only">{item.checked ? " — gathered" : " — still to buy"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The three read views.
 *
 * All three lists are read together because the metric cards summarise all three;
 * the console is small enough that one extra pair of requests is cheaper than a
 * card that shows a number the tab next to it disagrees with.
 */
export function KitchenView() {
  const pantry = useKitchen("pantry");
  const plan = useKitchen("plan");
  const shopping = useKitchen("shopping");

  const pantryItems = pantry.data?.view === "pantry" ? pantry.data.items : null;
  const planEntries = plan.data?.view === "plan" ? plan.data.entries : null;
  const shoppingItems = shopping.data?.view === "shopping" ? shopping.data.items : null;
  const toBuy = shoppingItems ? shoppingItems.filter((item) => !item.checked).length : null;

  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Metric
          label="Pantry"
          value={pantryItems ? pantryItems.length : null}
          unit="items tracked"
          error={pantry.error}
        />
        <Metric
          label="Week"
          value={planEntries ? planEntries.length : null}
          unit="meal slots planned"
          error={plan.error}
        />
        <Metric label="Shopping" value={toBuy} unit="items still to buy" error={shopping.error} />
      </div>

      <section className="panel p-4 sm:p-5">
        <Tabs defaultValue="pantry">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger
              value="pantry"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
            >
              Pantry
            </TabsTrigger>
            <TabsTrigger
              value="plan"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
            >
              Week
            </TabsTrigger>
            <TabsTrigger
              value="shopping"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
            >
              Shopping
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pantry" className="mt-3">
            <PantryList
              items={pantryItems}
              error={pantry.error}
              refresh={() => void pantry.refresh()}
            />
          </TabsContent>
          <TabsContent value="plan" className="mt-3">
            <PlanList
              entries={planEntries}
              error={plan.error}
              refresh={() => void plan.refresh()}
            />
          </TabsContent>
          <TabsContent value="shopping" className="mt-3">
            <ShoppingList
              items={shoppingItems}
              error={shopping.error}
              refresh={() => void shopping.refresh()}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
