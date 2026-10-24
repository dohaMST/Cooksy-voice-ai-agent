import { useState } from "react";
import { AlertTriangle, AudioLines, Brain, Cpu, ListTree, Mic, Plug, RefreshCw, Type, Volume2 } from "lucide-react";
import { PlanBuilder } from "@/components/plan-builder";
import { InlineKeyboard } from "@/components/telegram-run";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NAV_LABEL, normalizeText, paginate, type ActionProposal, type Screen } from "@/lib/voice/screen";
import { ENGINE_LABEL, getAgents, useVoiceSettings } from "@/lib/settings/voice";
import { useKitchen } from "@/lib/cooksy/console";
import type { ApprovalRecord } from "@/lib/cooksy/types";

export type PanelStage = "received" | "transcribing" | "planning" | "thinking" | "streaming" | "speaking" | "error";

/** One active screen: long text is paged in place, and controls never exceed four. */
export function PagedScreen({ text, screen, disabled, onSend }: {
  text: string;
  screen?: Screen | undefined;
  disabled: boolean;
  onSend: (value: string) => void;
}) {
  const pages = paginate(text);
  const [page, setPage] = useState(0);
  const index = Math.min(page, pages.length - 1);
  const last = index === pages.length - 1;

  type Control = { key: string; label: string; primary?: boolean; paging?: boolean; onClick: () => void };
  const controls: Control[] = [];
  if (index > 0) controls.push({ key: "prev", label: "‹ Previous", paging: true, onClick: () => setPage(index - 1) });
  if (!last) controls.push({ key: "next", label: "Next ›", primary: true, paging: true, onClick: () => setPage(index + 1) });
  if (last && screen) {
    screen.choices.forEach((c) => controls.push({ key: c.id, label: c.label, primary: true, onClick: () => onSend(c.value) }));
    screen.navigation.forEach((n) => controls.push({ key: n, label: NAV_LABEL[n], onClick: () => onSend(NAV_LABEL[n]) }));
  }
  const shown = controls.slice(0, 4);

  return (
    <>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{pages[index]}</p>
      {pages.length > 1 && <p className="dc-label mt-1 text-[10px]">Page {index + 1} / {pages.length}</p>}
      <InlineKeyboard buttons={shown.map((c) => ({ key: c.key, label: c.label, onClick: c.onClick, disabled: disabled && !c.paging }))} />
    </>
  );
}

const PIPELINE: { key: string; label: string; detail: string; stages: (PanelStage | "recording")[] }[] = [
  { key: "capture", label: "Audio capture", detail: "Hold-to-talk microphone", stages: ["recording"] },
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

const STAGE_ICON: Record<string, typeof Mic> = { capture: Mic, asr: AudioLines, plan: ListTree, think: Brain, stream: Type, speak: Volume2 };

/** Compact live readout of the agent answering right now. */
export function ModelStatusStrip() {
  const [voice] = useVoiceSettings();
  const label = getAgents()[voice.agent]?.label ?? voice.agent;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground" aria-label="Agent active now">
      <span className="flex min-w-0 items-center gap-1.5" title="The agent this console is talking to">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        <Cpu aria-hidden className="size-3 shrink-0 text-foreground/70" />
        <span className="truncate text-foreground">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1" title="Gateway route used for this agent">
        <Plug aria-hidden className="size-3 text-foreground/70" />
        <span>openclaw/{voice.agent}</span>
      </span>
    </div>
  );
}

/** Compact lifecycle strip shown under the microphone: icons instead of words. */
export function LifecycleStrip({ stage, recording }: { stage?: PanelStage | undefined; recording: boolean }) {
  const step = currentStep(stage, recording);
  const [voice] = useVoiceSettings();
  const detail = (key: string) =>
    key === "asr" ? (voice.asrEngine === "local" ? voice.asrModel : PIPELINE[1]!.detail)
    : key === "speak" ? ENGINE_LABEL[voice.engine]
    : PIPELINE.find((p) => p.key === key)?.detail ?? "";
  return (
    <div className="flex items-end gap-2" aria-label="Lifecycle progress">
      {PIPELINE.map((item, i) => {
        const state = step < 0 ? "idle" : i < step ? "done" : i === step ? "active" : "idle";
        const Icon = STAGE_ICON[item.key]!;
        return (
          <span key={item.key} title={`${item.label} — ${detail(item.key)}`} className="flex flex-col items-center gap-1">
            <Icon aria-hidden className={`size-4 ${state === "active" ? "animate-pulse text-primary" : state === "done" ? "text-foreground/70" : "text-muted-foreground/50"}`} />
            <span aria-hidden className="h-0.5 w-5 overflow-hidden rounded-full bg-border">
              <span className={`block h-full rounded-full transition-all duration-500 ${state === "done" ? "w-full bg-primary/60" : state === "active" ? "w-full animate-pulse bg-primary" : "w-0"}`} />
            </span>
          </span>
        );
      })}
      <span className="ml-0.5 pb-0.5 font-mono text-[10px] text-muted-foreground">{step < 0 ? "—" : `${step + 1}/6`}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-foreground">{value}</span>
    </div>
  );
}

export function ProfilePanel({ show = false }: { show?: boolean }) {
  return (
    <aside className={`${show ? "block" : "hidden"} space-y-4 pb-24 lg:block lg:pb-0 2xl:space-y-5`}>
      <PlanBuilder />
    </aside>
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
  const claimed = proposal ? pending.find((row) => row._id === proposal.id && row.tool === proposal.tool) : undefined;
  const unknownClaim = Boolean(proposal) && !claimed;

  if (error) {
    return (
      <p role="alert" className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-destructive">
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
              The agent mentioned a change, but no stored approval matches it. Nothing can be approved here.
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className="mt-2 space-y-3">
      {pending.map((row) => (
        <li key={row._id} className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-xs font-semibold text-foreground">{normalizeText(row.title)}</p>
            <span className={`shrink-0 font-mono text-[10px] ${RISK_CLASS[row.risk] ?? "text-muted-foreground"}`}>
              ● {(row.risk ?? "low").toUpperCase()}
            </span>
          </div>
          <p className="break-all font-mono text-[10px] text-primary">Tool · {row.tool}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{normalizeText(row.summary)}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{minutesLeft(row.expiresAt)}</p>
          <InlineKeyboard
            buttons={[
              { key: `${row._id}-approve`, label: "✓ Approve", onClick: () => onDecide(row._id, "approve"), disabled: disabled || busyId === row._id },
              { key: `${row._id}-deny`, label: "✕ Deny", tone: "danger", onClick: () => onDecide(row._id, "deny"), disabled: disabled || busyId === row._id },
            ]}
          />
        </li>
      ))}
    </ul>
  );
}

export function LifecyclePanel({
  statusLabel,
  turns,
  show = false,
  pending,
  proposal,
  approvalError,
  busyId,
  disabled = false,
  onDecide,
}: {
  show?: boolean;
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
    <aside className={`${show ? "block" : "hidden"} space-y-4 pb-24 lg:block lg:pb-0 2xl:space-y-5`}>
      <section className="panel p-4">
        <p className="dc-label text-[10px]">Current run</p>
        <div className="mt-2">
          <Row label="Status" value={statusLabel} />
          <Row label="Messages" value={String(turns)} />
        </div>
      </section>
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="dc-label text-[10px]">Approval</p>
          {pending.length > 0 && (
            <span className="font-mono text-[10px] text-severity-medium">● {pending.length} PENDING</span>
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
      <section className="panel p-4">
        <div className="flex items-center justify-between">
          <p className="dc-label text-[10px]">OpenClaw gateway</p>
          <span className="font-mono text-[10px] text-muted-foreground">127.0.0.1:18789</span>
        </div>
        <div className="mt-2">
          <Row label="Agent" value={agentLabel} />
          <Row label="Route" value={`/api/agent → openclaw/${voice.agent}`} />
        </div>
      </section>
    </aside>
  );
}

function ListMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 py-1">
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

function PantryList() {
  const { data, error, refresh } = useKitchen("pantry");
  if (error) return <ListError message={error} onRetry={() => void refresh()} />;
  if (!data) return <ListMessage>Reading the pantry…</ListMessage>;
  const items = data?.view === "pantry" ? data.items : [];
  if (!items.length) return <ListMessage>The pantry is empty. Ask Cook to add what you have.</ListMessage>;
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item._id} className="flex items-baseline justify-between gap-3 py-2 text-xs">
          <span className="min-w-0 truncate text-foreground">{normalizeText(item.name)}</span>
          <span className="shrink-0 font-mono text-muted-foreground">
            {item.quantity} {normalizeText(item.unit)}
            {item.bestBefore ? ` · ${item.bestBefore}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanList() {
  const { data, error, refresh } = useKitchen("plan");
  if (error) return <ListError message={error} onRetry={() => void refresh()} />;
  if (!data) return <ListMessage>Reading this week…</ListMessage>;
  const entries = data?.view === "plan" ? data.entries : [];
  if (!entries.length) return <ListMessage>Nothing is planned this week.</ListMessage>;
  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  return (
    <ul className="space-y-3">
      {[...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
        <li key={date}>
          <p className="dc-label text-[10px]">{date}</p>
          <ul className="mt-1 space-y-1">
            {rows.map((row) => (
              <li key={row._id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="shrink-0 font-mono text-muted-foreground">{row.meal}</span>
                <span className="min-w-0 truncate text-foreground">
                  {row.recipeName ? normalizeText(row.recipeName) : "Unknown recipe"}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ShoppingList() {
  const { data, error, refresh } = useKitchen("shopping");
  if (error) return <ListError message={error} onRetry={() => void refresh()} />;
  if (!data) return <ListMessage>Reading the shopping list…</ListMessage>;
  const items = data?.view === "shopping" ? data.items : [];
  if (!items.length) return <ListMessage>Nothing to buy. Ask Planner to build the list from the week.</ListMessage>;
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item._id} className="flex items-baseline justify-between gap-3 py-2 text-xs">
          <span className="min-w-0 truncate text-foreground">{normalizeText(item.name)}</span>
          <span className="shrink-0 font-mono text-muted-foreground">
            {item.quantity} {normalizeText(item.unit)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The three read views. Each list mounts only while its tab is open, so the
 * console does not read three collections every time the tab changes.
 */
export function KitchenPanel({ show = false }: { show?: boolean }) {
  return (
    <aside className={`${show ? "block" : "hidden"} space-y-4 pb-24 lg:block lg:pb-0 2xl:space-y-5`}>
      <section className="panel p-4">
        <p className="dc-label text-[10px]">Kitchen</p>
        <Tabs defaultValue="pantry" className="mt-2">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="pantry" className="rounded-full px-3 py-1.5 text-xs">Pantry</TabsTrigger>
            <TabsTrigger value="plan" className="rounded-full px-3 py-1.5 text-xs">Week</TabsTrigger>
            <TabsTrigger value="shopping" className="rounded-full px-3 py-1.5 text-xs">Shopping</TabsTrigger>
          </TabsList>
          <TabsContent value="pantry" className="mt-3"><PantryList /></TabsContent>
          <TabsContent value="plan" className="mt-3"><PlanList /></TabsContent>
          <TabsContent value="shopping" className="mt-3"><ShoppingList /></TabsContent>
        </Tabs>
      </section>
    </aside>
  );
}

export function Waveform({ level, active, stage }: { level: number; active: boolean; stage?: PanelStage | undefined }) {
  return (
    <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3">
      <ModelStatusStrip />
      <div aria-hidden className="flex h-12 min-w-0 items-center justify-center gap-1">
        {Array.from({ length: 36 }, (_, i) => {
          const wave = active ? 0.25 + Math.min(level * 4, 1) * Math.abs(Math.sin(i * 0.7 + level * 20)) : 0.12;
          return (
            <span key={i} className="w-1 rounded-full bg-primary transition-[height] duration-100"
              style={{ height: `${Math.max(8, wave * 100)}%`, opacity: active ? 0.9 : 0.3 }} />
          );
        })}
      </div>
      <div className="flex justify-center">
        <LifecycleStrip stage={stage} recording={active} />
      </div>
    </div>
  );
}
