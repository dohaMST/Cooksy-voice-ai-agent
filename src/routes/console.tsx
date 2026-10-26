import { unlockSpeaker } from "@/lib/voice/speak";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChefHat,
  ListTree,
  MessageCircle,
  Mic,
  Paperclip,
  Radio,
  RotateCcw,
  SendHorizontal,
  SlidersHorizontal,
  Square,
  ThumbsUp,
  Volume2,
  VolumeX,
  X as XIcon,
} from "lucide-react";
import { recordWav, type Recording } from "@/lib/voice/record-wav";
import { streamAgentAnswer, transcribeRecording, type Turn } from "@/lib/voice/agent";
import { transcribeLocal } from "@/lib/voice/local-asr";
import {
  BotBubble,
  InlineKeyboard,
  StepLog,
  TypingDots,
  UserBubble,
  useRunOptions,
  type RunStep,
} from "@/components/chat-bubbles";
import { getAgents, speakWith, useVoiceSettings } from "@/lib/settings/voice";
import { GeneralSettings } from "@/components/general-settings";
import {
  claimsApproval,
  cleanRaw,
  normalizeText,
  parseReply,
  spokenScreen,
  stripMarkers,
  type Command,
  type Screen,
} from "@/lib/voice/screen";
import { resolveGatewayModel } from "@/lib/ai/models";
import { useApprovals } from "@/lib/cooksy/console";
import { decisionFocus, describeDecision } from "@/lib/cooksy/outcome";
import { weekOffsetFor } from "@/lib/cooksy/week";
import type { KitchenView as KitchenTab } from "@/lib/cooksy/types";
import { KitchenView, PagedScreen, RunStrip, RunView } from "@/components/console-panels";
import { EmberField, VoiceOrb } from "@/components/ember";
import { NoticeBar, type Notice, type NoticeTone } from "@/components/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCENTS, clampTheme, useTheme, type Accent } from "@/lib/settings/theme";

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "Cooksy — talk to your kitchen agents" },
      {
        name: "description",
        content:
          "Hold to talk, watch the agent move through received, thinking and synthesizing, then hear the answer spoken back. Cook reads the kitchen; Planner proposes every change for your approval.",
      },
      { property: "og:title", content: "Cooksy — talk to your kitchen agents" },
      {
        property: "og:description",
        content:
          "A voice console for a kitchen: pantry, week plan and shopping list, with every change gated by your approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoiceConsole,
});

type Stage =
  "received" | "transcribing" | "planning" | "thinking" | "streaming" | "speaking" | "error";
type View = "talk" | "kitchen" | "run";

const STAGE_LABEL: Record<Stage, string> = {
  received: "Received",
  transcribing: "Transcribing",
  planning: "Planning",
  thinking: "Thinking",
  streaming: "Synthesizing",
  speaking: "Speaking",
  error: "Failed",
};

const VIEWS = [
  { key: "talk", label: "Talk", Icon: MessageCircle },
  { key: "kitchen", label: "Kitchen", Icon: ChefHat },
  { key: "run", label: "Run", Icon: Activity },
] as const;

/** One control style for every chip in the console. 44px tall on touch-sized
    screens, 36px once there is a fine pointer. */
const CHIP =
  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:h-9";
const ICON_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-muted-foreground transition-colors hover:text-foreground sm:size-9";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  screen?: Screen;
  reasoning?: string;
  liked?: boolean;
  at: number;
  steps?: RunStep[];
  sender?: string;
  /** Written by the console (an approval outcome), not by a model: nothing to retry or think about. */
  system?: boolean;
};

type Run = {
  stage: Stage;
  heard: string;
  answer: string;
  reasoning: string;
  error?: string;
  steps: RunStep[];
  sender?: string;
};

const newId = () => Math.random().toString(36).slice(2);

function VoiceConsole() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [view, setView] = useState<View>("talk");

  const recordingRef = useRef<Recording | null>(null);
  const startingRef = useRef(false);
  const releaseRef = useRef(false);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  const reasoningRef = useRef("");
  const stepsRef = useRef<RunStep[]>([]);
  const [runOptions, setRunOptions] = useRunOptions();
  const [voice, setVoice] = useVoiceSettings();
  const settingsRef = useRef({ runOptions, voice });
  settingsRef.current = { runOptions, voice };
  const [speaking, setSpeaking] = useState(false);
  const [standby, setStandby] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const commandRef = useRef<(command: Command) => string | null>(() => null);

  /** One place to raise a notice, so every message carries its own tone. */
  const showNotice = useCallback((tone: NoticeTone, message: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, tone, message });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  // The approval queue is the source of truth: the console polls cooksy-api through
  // its own server route and never trusts the model's account of what is pending.
  const { pending, error: approvalError, decide } = useApprovals();
  const [busyApproval, setBusyApproval] = useState<string | null>(null);
  const [kitchenVersion, setKitchenVersion] = useState(0);
  // Owned here, not by KitchenView: an approval has to be able to point the Week
  // tab at the week it wrote to, and switching views must not lose the week the
  // operator was reading.
  const [kitchenTab, setKitchenTab] = useState<KitchenTab>("pantry");
  const [kitchenWeek, setKitchenWeek] = useState(0);

  const addStep = useCallback((label: string, detail?: string, tone?: RunStep["tone"]) => {
    stepsRef.current = [
      ...stepsRef.current,
      { label, at: Date.now(), ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) },
    ];
    const steps = stepsRef.current;
    setRun((current) => (current ? { ...current, steps } : current));
  }, []);
  const resetSteps = () => {
    stepsRef.current = [];
  };

  const appendMessage = useCallback((message: Message) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
    return messagesRef.current;
  }, []);

  // Kept current every render so the post-turn approval check (a timeout, not a
  // render) reads the queue as it stands after the poll that follows the reply.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  /**
   * Announces an approval the moment the queue gains one.
   *
   * The sidebar card and the Run badge are the durable record, but the operator is
   * usually in Talk when the agent asks, and that view has no queue on screen. One
   * notice per new row, naming it, so a proposal is never silently waiting.
   */
  const seenApprovalsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = pending.filter((row) => !seenApprovalsRef.current.has(row._id));
    for (const row of pending) seenApprovalsRef.current.add(row._id);
    const first = fresh[0];
    if (!first) return;
    showNotice(
      "info",
      fresh.length === 1
        ? `Waiting for your approval — ${normalizeText(first.title)}. Open Run to approve or deny.`
        : `${fresh.length} approvals are waiting for you. Open Run to review them.`,
    );
  }, [pending, showNotice]);

  // Timers the console sets after a turn; cleared on unmount so a warn never fires
  // into a route that is gone.
  const guardTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const id of guardTimersRef.current) window.clearTimeout(id);
      guardTimersRef.current = [];
    },
    [],
  );

  /**
   * Keeps the conversation at its newest message.
   *
   * Two things made this stick at the first message: the Talk section unmounts
   * when another view is opened (a fresh mount starts at scrollTop 0, and an
   * effect keyed only on the messages never re-ran), and a smooth scroll restarts
   * on every streamed token and can settle short of the bottom.
   *
   * Pinning is dropped as soon as the operator scrolls up to read something older,
   * so a reply never yanks the page out from under them.
   */
  const onChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useLayoutEffect(() => {
    if (view === "talk") pinnedRef.current = true;
  }, [view]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, run, view]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setLevel(recordingRef.current?.level() ?? 0), 100);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const runAgent = useCallback(
    async (history: Message[], signal: AbortSignal) => {
      const { runOptions: opts, voice: voiceSettings } = settingsRef.current;
      setRun((current) => (current ? { ...current, stage: "planning" } : current));
      reasoningRef.current = "";
      const turns: Turn[] = history.map(({ role, text }) => ({ role, text }));

      // One agent, picked in the console. No fallback and no silent swap: an
      // unknown agent shows the error instead of answering as somebody else.
      const agentLabel = getAgents()[voiceSettings.agent]?.label ?? voiceSettings.agent;
      const model = resolveGatewayModel(voiceSettings.agent);
      if (!model)
        throw new Error(
          `${agentLabel} is not an agent this console can reach. Pick Cook or Planner.`,
        );
      addStep("Agent", `${agentLabel} · ${model}`);
      setRun((current) => (current ? { ...current, sender: agentLabel, answer: "" } : current));

      let thinking = false;
      let writing = false;
      const raw = await streamAgentAnswer(
        turns,
        {
          onThinking: (reasoning) => {
            if (!thinking) {
              thinking = true;
              addStep("Thinking");
            }
            reasoningRef.current = reasoning;
            setRun((current) =>
              current
                ? {
                    ...current,
                    reasoning,
                    stage: current.stage === "streaming" ? current.stage : "thinking",
                  }
                : current,
            );
          },
          onAnswer: (text) => {
            if (!writing) {
              writing = true;
              addStep("Writing reply");
            }
            if (opts.typing)
              setRun((current) =>
                current
                  ? { ...current, answer: stripMarkers(cleanRaw(text)).text, stage: "streaming" }
                  : current,
              );
          },
        },
        signal,
        model,
      );

      // Prose is the contract: a plain spoken answer is a complete answer. A JSON
      // screen is still honoured if the model volunteers one.
      const screen: Screen = parseReply(raw);
      for (const command of screen.commands ?? []) {
        const result = commandRef.current(command);
        addStep(
          result ? "Applied" : "Not available",
          result ?? `${command.name} ${command.value}`.trim(),
          result ? undefined : "error",
        );
      }
      if (screen.actionProposal) {
        addStep(
          "Approval waiting",
          `${normalizeText(screen.actionProposal.title)} · ${screen.actionProposal.tool}`,
          "warn",
        );
      }
      addStep(
        "Reply ready",
        `${screen.choices.length} button${screen.choices.length === 1 ? "" : "s"}`,
      );
      if (opts.speak) addStep("Speaking");
      appendMessage({
        id: newId(),
        role: "assistant",
        text: screen.text,
        screen,
        reasoning: reasoningRef.current,
        at: Date.now(),
        steps: stepsRef.current,
        sender: agentLabel,
      });
      setRun(null);

      // An agent can describe an approval it never actually proposed. The free-tier
      // fallback model does exactly that: the reply says "I am requesting approval…"
      // while no tool call was made, so no card ever appears. Once the next poll has
      // landed, a still-empty queue means there is nothing to approve — say so instead
      // of leaving the operator waiting for a card that will never arrive. Silence when
      // anything is waiting, so a question about the existing queue never cries wolf.
      if (claimsApproval(screen.text)) {
        const timer = window.setTimeout(() => {
          if (pendingRef.current.length > 0) return;
          showNotice(
            "warn",
            `${agentLabel} said it was asking for approval, but nothing reached the approval queue. Nothing is waiting in Run — ask again.`,
          );
        }, 2_500);
        guardTimersRef.current = [...guardTimersRef.current, timer];
      }

      if (!opts.speak) return;
      try {
        setSpeaking(true);
        await speakWith(voiceSettings, spokenScreen(screen), signal);
      } catch (error) {
        if (!signal.aborted)
          showNotice("error", error instanceof Error ? error.message : "The voice engine failed");
      } finally {
        setSpeaking(false);
      }
    },
    [addStep, appendMessage, showNotice],
  );

  const sendText = useCallback(
    (text: string) => {
      if (run || isRecording) return;
      // The reply is spoken long after this click, so unlock audio while we still
      // have the gesture that browsers require.
      unlockSpeaker();
      resetSteps();
      addStep("Received", "text message");
      const history = appendMessage({ id: newId(), role: "user", text, at: Date.now() });
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        stage: "planning",
        heard: text,
        answer: "",
        reasoning: "",
        steps: stepsRef.current,
      });
      void runAgent(history, controller.signal)
        .catch((error) => {
          if (controller.signal.aborted) return setRun(null);
          setRun({
            stage: "error",
            heard: "",
            answer: "",
            reasoning: "",
            error: error instanceof Error ? error.message : "That step failed",
            steps: stepsRef.current,
          });
        })
        .finally(() => {
          abortRef.current = null;
        });
    },
    [addStep, appendMessage, isRecording, run, runAgent],
  );

  const finishTurn = useCallback(
    async (file: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      resetSteps();
      stepsRef.current = [{ label: "Received", detail: "voice note", at: Date.now() }];
      setRun({ stage: "received", heard: "", answer: "", reasoning: "", steps: stepsRef.current });
      try {
        setRun((current) => (current ? { ...current, stage: "transcribing" } : current));
        addStep("Transcribing");
        const selectedVoice = settingsRef.current.voice;
        const onPartial = (partial: string) =>
          setRun((current) => (current ? { ...current, heard: partial } : current));
        const heard =
          selectedVoice.asrEngine === "local"
            ? await transcribeLocal(
                file,
                selectedVoice.asrUrl,
                selectedVoice.asrModel,
                onPartial,
                controller.signal,
              )
            : await transcribeRecording(file, onPartial, controller.signal);
        const userMessage: Message = { id: newId(), role: "user", text: heard, at: Date.now() };
        addStep("Heard", heard.length > 60 ? `${heard.slice(0, 60)}…` : heard);
        const history = appendMessage(userMessage);
        setRun((current) => (current ? { ...current, heard, stage: "planning" } : current));
        await runAgent(history, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          setRun(null);
          return;
        }
        const message = error instanceof Error ? error.message : "Something went wrong";
        setRun({
          stage: "error",
          heard: "",
          answer: "",
          reasoning: "",
          error: message,
          steps: stepsRef.current,
        });
      } finally {
        abortRef.current = null;
      }
    },
    [addStep, appendMessage, runAgent],
  );

  const startRecording = useCallback(async () => {
    if (isRecording || run || startingRef.current) return;
    unlockSpeaker();
    startingRef.current = true;
    releaseRef.current = false;
    try {
      recordingRef.current = await recordWav();
      setIsRecording(true);
      startingRef.current = false;
      // Released before the microphone finished opening: finish the turn now.
      if (releaseRef.current) {
        releaseRef.current = false;
        void stopRecordingRef.current();
      }
    } catch {
      startingRef.current = false;
      // Standby would otherwise re-request the microphone every 250 ms for as long
      // as the tab is open: the failed run clears `busy`, which re-arms the effect.
      // One loud error and standby off beats an invisible retry loop.
      if (standby) setStandby(false);
      setRun({
        stage: "error",
        heard: "",
        answer: "",
        reasoning: "",
        steps: stepsRef.current,
        error: "I need microphone access to hear you. Allow it and try again.",
      });
    }
  }, [isRecording, run, standby]);

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) {
      if (startingRef.current) releaseRef.current = true;
      return;
    }
    recordingRef.current = null;
    setIsRecording(false);
    setLevel(0);
    try {
      const file = await recording.stop();
      void finishTurn(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording failed";
      setRun({
        stage: "error",
        heard: "",
        answer: "",
        reasoning: "",
        error: message,
        steps: stepsRef.current,
      });
    }
  }, [finishTurn]);
  stopRecordingRef.current = stopRecording;

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRun(null);
  }, []);

  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const history = messages.slice(0, messages.lastIndexOf(lastUser) + 1);
    messagesRef.current = history;
    setMessages(history);
    const controller = new AbortController();
    abortRef.current = controller;
    stepsRef.current = [{ label: "Retry", detail: "same question", at: Date.now() }];
    setRun({
      stage: "planning",
      heard: lastUser.text,
      answer: "",
      reasoning: "",
      steps: stepsRef.current,
    });
    void runAgent(history, controller.signal)
      .catch((error) => {
        if (controller.signal.aborted) return setRun(null);
        setRun({
          stage: "error",
          heard: "",
          answer: "",
          reasoning: "",
          steps: stepsRef.current,
          error: error instanceof Error ? error.message : "Retry failed",
        });
      })
      .finally(() => {
        abortRef.current = null;
      });
  }, [messages, runAgent]);

  const [, setTheme] = useTheme();
  const busy = Boolean(run) && run?.stage !== "error";

  // Standby: listen hands-free, send after the chosen pause of silence, and wait while the agent talks.
  const standbyRef = useRef({ heard: false, lastLoud: 0 });
  useEffect(() => {
    if (!standby || busy || speaking || isRecording || settingsOpen) return;
    const t = window.setTimeout(() => {
      standbyRef.current = { heard: false, lastLoud: Date.now() };
      void startRecording();
    }, 250);
    return () => window.clearTimeout(t);
  }, [standby, busy, speaking, isRecording, settingsOpen, startRecording]);
  useEffect(() => {
    if (!standby || !isRecording) return;
    const t = window.setInterval(() => {
      const lv = recordingRef.current?.level() ?? 0;
      const st = standbyRef.current;
      if (lv > 0.06) {
        st.heard = true;
        st.lastLoud = Date.now();
      } else if (st.heard && Date.now() - st.lastLoud > voice.standbyPause) {
        st.heard = false;
        void stopRecording();
      }
    }, 80);
    return () => window.clearInterval(t);
  }, [standby, isRecording, voice.standbyPause, stopRecording]);

  const toggleStandby = useCallback(() => {
    setStandby((on) => {
      if (on && recordingRef.current) {
        recordingRef.current.cancel();
        recordingRef.current = null;
        setIsRecording(false);
        setLevel(0);
      }
      return !on;
    });
  }, []);

  // Voice commands: only these reversible controls; returns a confirmation or null if it can't be applied.
  commandRef.current = (command) => {
    const v = command.value.trim().toLowerCase();
    switch (command.name) {
      case "show_tab": {
        // `plan` is the Week tab inside Kitchen; the console has no separate view for it.
        const target = v === "plan" ? "kitchen" : v;
        if (target !== "talk" && target !== "kitchen" && target !== "run") return null;
        setView(target);
        return v === "plan"
          ? "Showing the week plan"
          : `Showing ${target === "kitchen" ? "Kitchen" : target === "run" ? "Run" : "Talk"}`;
      }
      case "set_agent": {
        const roster = getAgents();
        const agent = roster[v];
        if (!agent) return null;
        setVoice((previous) => ({ ...previous, agent: v }));
        return `Agent set to ${agent.label}`;
      }
      case "set_speaking_rate": {
        const rate = Number(v);
        if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) return null;
        setVoice((previous) => ({ ...previous, rate: Math.round(rate * 100) / 100 }));
        return `Speaking rate ${rate.toFixed(2)}×`;
      }
      case "set_accent": {
        if (!(v in ACCENTS)) return null;
        setTheme((p) => ({ ...p, accent: v as Accent }));
        return `Accent ${ACCENTS[v as Accent].label}`;
      }
      case "set_style": {
        const m = v.match(/^(blur|glass|radius)\s*[:=]?\s*(-?\d+)$/);
        if (!m) return null;
        const key = m[1] as "blur" | "glass" | "radius";
        let applied = 0;
        setTheme((p) => {
          const next = clampTheme({ ...p, [key]: Number(m[2]) });
          applied = next[key];
          return next;
        });
        return `${key === "glass" ? "Glass opacity" : key === "blur" ? "Glass blur" : "Corner roundness"} ${applied || m[2]}`;
      }
      case "open_settings":
        setSettingsOpen(true);
        return "General settings opened";
      case "close_settings":
        setSettingsOpen(false);
        return "General settings closed";
      case "standby":
        if (v !== "on" && v !== "off") return null;
        if ((v === "on") !== standby) toggleStandby();
        return `Standby ${v}`;
    }
    return null;
  };

  const stopAll = useCallback(() => {
    stopRun();
    // Escape has to stop the microphone too, or the recorder keeps the device open
    // after the run it was feeding is gone.
    if (recordingRef.current) {
      recordingRef.current.cancel();
      recordingRef.current = null;
      releaseRef.current = false;
      setIsRecording(false);
      setLevel(0);
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    setSpeaking(false);
  }, [stopRun]);

  /**
   * Sends the human's decision. cooksy-api is the only thing that executes, and
   * its answer is the only outcome we report — nothing is assumed to have worked.
   */
  const decideApproval = useCallback(
    async (id: string, decision: "approve" | "deny") => {
      setBusyApproval(id);
      // The pending row disappears the moment it is decided, so read it first: the
      // confirmation in the chat is built from the stored approval and cooksy-api's
      // own result, never from the model's account of what it was going to do.
      const record = pending.find((row) => row._id === id);
      try {
        const outcome = await decide(id, decision);
        if (!outcome) return; // the hook already put the real error on screen
        if (outcome.ok) {
          showNotice(
            "success",
            decision === "approve"
              ? "Approved and run. The kitchen lists now show the result."
              : "Denied. Nothing was changed.",
          );
          setKitchenVersion((n) => n + 1);
          if (record) {
            appendMessage({
              id: newId(),
              role: "assistant",
              text: describeDecision(record, decision, outcome),
              at: Date.now(),
              sender: "Kitchen",
              system: true,
            });
            // Point the Kitchen view at what just changed; an approval for a date in
            // another week used to land on a tab that could not show it.
            const focus = decision === "approve" ? decisionFocus(record, outcome) : null;
            if (focus) {
              setKitchenTab(focus.tab);
              if (focus.date) setKitchenWeek(weekOffsetFor(focus.date));
            }
          }
        } else if (outcome.code === "failed") {
          showNotice(
            "error",
            `Approved, but the action failed: ${outcome.error ?? "no reason given"}`,
          );
          setKitchenVersion((n) => n + 1);
          if (record) {
            appendMessage({
              id: newId(),
              role: "assistant",
              text: describeDecision(record, decision, outcome),
              at: Date.now(),
              sender: "Kitchen",
              system: true,
            });
          }
        } else if (outcome.code === "not_found") {
          showNotice("error", "That approval no longer exists.");
        } else if (outcome.code === "expired") {
          showNotice("error", "That approval expired before it was decided.");
        } else {
          showNotice("info", `Nothing changed — ${outcome.code.replace(/_/g, " ")}.`);
        }
      } finally {
        setBusyApproval(null);
      }
    },
    [appendMessage, decide, pending, showNotice],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        e.preventDefault();
        toggleStandby();
      }
      if (e.key === "Escape" && !settingsOpen) stopAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleStandby, stopAll, settingsOpen]);

  const submitDraft = () => {
    const text = draft.trim();
    if ((!text && !attachment) || busy || isRecording) return;
    const full = attachment
      ? `${text || "Please review the attached file."}\n\nAttached file "${attachment.name}":\n${attachment.text}`
      : text;
    setDraft("");
    setAttachment(null);
    sendText(full);
    inputRef.current?.focus();
  };
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000)
      return showNotice("warn", "That file is too large. Attach a text file under 200 KB.");
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      // A file that cannot be read is a real failure, not an empty attachment.
      return showNotice(
        "error",
        error instanceof Error
          ? `That file could not be read: ${error.message}`
          : "That file could not be read.",
      );
    }
    if (text.includes("\u0000"))
      return showNotice("warn", "Only text files can be attached (txt, md, json, csv, yaml, log).");
    setAttachment({ name: file.name, text: text.slice(0, 20_000) });
  };

  const active = VIEWS.find((item) => item.key === view) ?? VIEWS[0];
  const ActiveIcon = active.Icon;
  const empty = messages.length === 0 && !run;
  const toggleSpeak = () => setRunOptions((previous) => ({ ...previous, speak: !previous.speak }));

  return (
    <main className="relative flex min-h-dvh w-full text-foreground">
      <a
        href="#console-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to the console
      </a>
      <EmberField />
      <div aria-hidden className="ember-haze pointer-events-none fixed inset-0 z-0" />

      {/* Desktop rail. Below lg the same sections live in the floating bottom nav. */}
      <aside className="relative z-10 hidden w-60 shrink-0 flex-col border-r border-white/[0.06] bg-black/25 backdrop-blur-xl lg:sticky lg:top-0 lg:flex lg:h-dvh xl:w-64">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <Link to="/" aria-label="Cooksy home" className="flex items-center gap-2.5 rounded-lg">
            <img
              src="/cooksy-mark.png"
              alt=""
              className="size-9 shrink-0 rounded-full object-contain ring-1 ring-primary/20"
            />
            <span className="text-[17px] font-semibold tracking-tight">Cooksy</span>
          </Link>
          <span className="ml-auto rounded-full border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Beta
          </span>
        </div>

        <nav aria-label="Console sections" className="flex-1 space-y-1 px-3">
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
              className={`nav-item ${view === key ? "bg-white/[0.07] text-foreground" : "hover:bg-white/[0.04] hover:text-foreground"}`}
            >
              <Icon
                className={`size-4 shrink-0 ${view === key ? "text-primary" : ""}`}
                aria-hidden
              />
              <span>{label}</span>
              {key === "run" && pending.length > 0 && (
                <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {pending.length > 0 && (
          <div className="mx-3 mb-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3">
            <p className="dc-label text-primary/80">Waiting for you</p>
            <ul className="mt-2 space-y-1.5">
              {pending.slice(0, 3).map((row) => (
                <li key={row._id} className="truncate text-xs text-foreground/90">
                  {normalizeText(row.title)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setView("run")}
              className="mt-2 text-[11px] font-semibold text-primary hover:underline"
            >
              Review {pending.length} →
            </button>
          </div>
        )}

        <div className="space-y-1 border-t border-white/[0.06] p-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="nav-item hover:bg-white/[0.04] hover:text-foreground"
          >
            <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
            <span>Settings</span>
          </button>
          <div className="mt-1 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <img
              src="/cooksy-mark.png"
              alt=""
              aria-hidden
              className="size-5 shrink-0 rounded-full ring-1 ring-primary/20"
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[11px] font-semibold text-foreground/85">Cooksy</p>
              <p className="truncate text-[10px] text-muted-foreground/70">© 2026 Doha Mastour</p>
            </div>
          </div>
        </div>
      </aside>

      {/* App shell height on every screen: the header stays put, the conversation
          scrolls, and the composer stays reachable above the floating nav. */}
      <div className="relative z-10 flex h-dvh min-w-0 flex-1 flex-col pb-24 lg:pb-0">
        <header className="sticky top-0 z-20 shrink-0 border-b border-white/[0.06] bg-background/55 backdrop-blur-xl backdrop-saturate-150">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <Link to="/" aria-label="Cooksy home" className="flex items-center gap-2 rounded-lg">
                <img
                  src="/cooksy-mark.png"
                  alt=""
                  className="size-7 shrink-0 rounded-full object-contain ring-1 ring-primary/20"
                />
                <span className="text-sm font-semibold tracking-tight">Cooksy</span>
              </Link>
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground">
                <ActiveIcon className="size-3.5 text-primary" aria-hidden />
                {active.label}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleStandby}
                aria-pressed={standby}
                title="Standby (F9)"
                className={`${CHIP} ${standby ? "border-primary/45 bg-primary/10 text-primary" : ""}`}
              >
                <Radio className={`size-3.5 ${standby ? "animate-pulse" : ""}`} aria-hidden />
                <span className="sr-only sm:not-sr-only">
                  {standby ? "Standing by" : "Standby"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="General settings"
                title="General settings"
                className={ICON_BUTTON}
              >
                <SlidersHorizontal className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {/* One scroll container for every view: Talk scrolls its stream, Kitchen and
            Run scroll their own content, and the floating nav never covers it. */}
        <div
          id="console-main"
          tabIndex={-1}
          className="scroll-thin mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 outline-none sm:px-6 lg:pb-6"
        >
          {view === "talk" && (
            <section className="flex min-h-0 flex-1 flex-col">
              {empty ? (
                <div className="rise-in flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 text-center sm:pt-10 [@media(max-height:640px)]:py-1">
                  {/* my-auto rather than justify-center: when the hero is taller
                      than the space left by the composer it starts at the top and
                      scrolls, instead of being clipped somewhere unreachable. */}
                  <div className="my-auto">
                    <div className="relative mx-auto grid size-22 place-items-center sm:size-32 [@media(max-height:640px)]:size-20">
                      <VoiceOrb level={level} active={isRecording} />
                      <img
                        src="/cooksy-mark.png"
                        alt=""
                        className="size-[86%] rounded-full object-contain ring-1 ring-primary/25 sm:size-24"
                      />
                    </div>
                    <h1 className="mt-3 text-[26px] font-semibold sm:mt-6 sm:text-4xl">
                      Welcome to <span className="text-primary">Cooksy</span>
                    </h1>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground [@media(max-height:640px)]:hidden">
                      Two agents, one kitchen. Cook reads what you have, Planner proposes what to
                      change — and nothing is written without your approval.
                    </p>
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground/70">
                      hold the mic · F9 standby · Esc stop
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <RunStrip level={level} active={isRecording} stage={run?.stage} />
                  <h1 className="sr-only">Cooksy voice console</h1>
                  <div
                    ref={scrollRef}
                    onScroll={onChatScroll}
                    className="scroll-thin mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pb-2 pr-1"
                  >
                    {/* role=log announces each finished turn once; the live status card
                        sits outside it so streaming text is not read out on every token. */}
                    <div
                      role="log"
                      aria-live="polite"
                      aria-relevant="additions"
                      aria-label="Conversation"
                      className="space-y-4"
                    >
                      {messages.map((message) =>
                        message.role === "user" ? (
                          <UserBubble key={message.id} text={message.text} at={message.at} />
                        ) : (
                          <div key={message.id} className="space-y-1.5">
                            <BotBubble
                              sender={`Cooksy${message.sender ? ` · ${message.sender}` : ""}`}
                              at={message.at}
                            >
                              <PagedScreen
                                text={message.text}
                                screen={
                                  message.id === messages[messages.length - 1]?.id
                                    ? message.screen
                                    : undefined
                                }
                                disabled={busy || isRecording}
                                onSend={sendText}
                              />
                              {message.steps && (
                                <StepLog
                                  steps={message.steps}
                                  defaultOpen={runOptions.expandSteps}
                                />
                              )}
                            </BotBubble>
                            <div className="flex flex-wrap items-center gap-1 pl-1">
                              <button
                                type="button"
                                aria-pressed={Boolean(message.liked)}
                                onClick={() => {
                                  messagesRef.current = messagesRef.current.map((item) =>
                                    item.id === message.id ? { ...item, liked: !item.liked } : item,
                                  );
                                  setMessages(messagesRef.current);
                                }}
                                className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-colors hover:bg-white/[0.06] ${message.liked ? "text-primary" : "text-muted-foreground"}`}
                              >
                                <ThumbsUp className="size-3" aria-hidden /> Useful
                              </button>
                              {!message.system && (
                                <>
                                  <button
                                    type="button"
                                    onClick={retry}
                                    disabled={busy}
                                    className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50"
                                  >
                                    <RotateCcw className="size-3" aria-hidden /> Retry
                                  </button>
                                  {/* Only when the provider actually streamed a reasoning
                                      summary: OpenClaw's chat-completions endpoint has no
                                      reasoning channel, so offering the button regardless
                                      opened an empty panel. */}
                                  {message.reasoning?.trim() ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenDetails((current) =>
                                          current === message.id ? null : message.id,
                                        )
                                      }
                                      className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                                    >
                                      <ListTree className="size-3" aria-hidden /> Thinking
                                    </button>
                                  ) : null}
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setSpeaking(true);
                                  void speakWith(voice, message.text)
                                    .catch((e: unknown) =>
                                      showNotice(
                                        "error",
                                        e instanceof Error ? e.message : "The voice engine failed",
                                      ),
                                    )
                                    .finally(() => setSpeaking(false));
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                              >
                                <Volume2 className="size-3" aria-hidden /> Replay
                              </button>
                            </div>
                            {openDetails === message.id && message.reasoning?.trim() && (
                              <div className="panel p-4">
                                <p className="dc-label">Agent thinking</p>
                                <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                                  {message.reasoning}
                                </p>
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>

                    {run && (
                      <StatusCard
                        run={run}
                        onDismiss={() => setRun(null)}
                        onCancel={stopRun}
                        onRetry={retry}
                      />
                    )}
                  </div>
                </>
              )}

              <NoticeBar notice={notice} onDismiss={dismissNotice} />

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitDraft();
                }}
                className="panel mt-2.5 shrink-0 p-2.5 sm:mt-3 sm:p-3"
              >
                {attachment && (
                  <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                    <Paperclip className="size-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => setAttachment(null)}
                      className="hover:text-foreground"
                    >
                      <XIcon className="size-3" aria-hidden />
                    </button>
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  id="composer-message"
                  name="message"
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitDraft();
                    }
                  }}
                  placeholder="Ask anything, or hold to talk…"
                  aria-label="Message"
                  className="block max-h-40 min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />
                <div className="mt-1 flex items-center gap-1.5">
                  {/* The toolbar wraps rather than hiding controls behind a
                      sideways scroll: on a phone every control stays reachable. */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <Select
                      name="agent"
                      value={voice.agent}
                      onValueChange={(value) =>
                        setVoice((previous) => ({ ...previous, agent: value }))
                      }
                    >
                      <SelectTrigger
                        aria-label="Agent"
                        className={`${CHIP} w-auto gap-1.5 pl-2.5 pr-2 [&>span]:line-clamp-1`}
                      >
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="min-w-[11rem]">
                        {Object.entries(getAgents()).map(([id, agent]) => (
                          <SelectItem key={id} value={id}>
                            {agent.label.replace("Cooksy ", "")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <button
                      type="button"
                      onClick={toggleSpeak}
                      aria-pressed={runOptions.speak}
                      className={`${CHIP} ${runOptions.speak ? "border-primary/45 bg-primary/10 text-primary" : ""}`}
                    >
                      {runOptions.speak ? (
                        <Volume2 className="size-3.5" aria-hidden />
                      ) : (
                        <VolumeX className="size-3.5" aria-hidden />
                      )}
                      <span className="sr-only sm:not-sr-only">Speak</span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleStandby}
                      aria-pressed={standby}
                      className={`${CHIP} ${standby ? "border-primary/45 bg-primary/10 text-primary" : ""}`}
                    >
                      <Radio className={`size-3.5 ${standby ? "animate-pulse" : ""}`} aria-hidden />
                      <span className="sr-only sm:not-sr-only">Standby</span>
                    </button>

                    <label
                      className={`${CHIP} cursor-pointer px-2.5`}
                      aria-label="Attach a text file"
                    >
                      <Paperclip className="size-3.5" aria-hidden />
                      <input
                        type="file"
                        id="composer-attachment"
                        name="attachment"
                        className="sr-only"
                        accept=".txt,.md,.json,.csv,.yaml,.yml,.log,text/*"
                        onChange={(e) => {
                          void attach(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <div className="relative grid size-16 shrink-0 place-items-center">
                    <VoiceOrb level={level} active={isRecording} />
                    <button
                      type="button"
                      onPointerDown={() => void startRecording()}
                      onPointerUp={() => void stopRecording()}
                      onPointerLeave={() => isRecording && void stopRecording()}
                      onPointerCancel={() => isRecording && void stopRecording()}
                      // A keyboard activation fires a click with detail 0 and no pointer
                      // events, so Space/Enter would otherwise do nothing at all. Pointer
                      // clicks are already handled above and are ignored here.
                      onClick={(e) => {
                        if (e.detail !== 0) return;
                        if (isRecording) void stopRecording();
                        else void startRecording();
                      }}
                      disabled={busy}
                      aria-label={isRecording ? "Stop recording and send" : "Start recording"}
                      aria-pressed={isRecording}
                      className="mic-button relative z-10 grid size-11 place-items-center rounded-full active:scale-95 disabled:opacity-40"
                    >
                      <Mic className="size-[18px]" aria-hidden />
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || isRecording || (!draft.trim() && !attachment)}
                    aria-label="Send"
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.05] text-foreground transition-colors hover:bg-white/10 disabled:opacity-40 sm:size-10"
                  >
                    <SendHorizontal className="size-4" aria-hidden />
                  </button>
                </div>
              </form>

              <p
                className="mt-2 shrink-0 text-center font-mono text-[10px] text-muted-foreground/70"
                aria-live="polite"
              >
                {isRecording
                  ? standby
                    ? "standing by… pause to send"
                    : "listening… release to send"
                  : busy
                    ? "agent is running · Esc stop"
                    : speaking
                      ? "speaking · Esc stop"
                      : empty
                        ? "two agents · every write needs your approval"
                        : "hold to talk · F9 standby · Esc stop"}
              </p>
              {(busy || speaking) && (
                <button
                  type="button"
                  onClick={stopAll}
                  className="mx-auto mt-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 text-xs text-foreground transition-colors hover:bg-white/10"
                >
                  <Square className="size-3" aria-hidden /> Stop
                </button>
              )}
            </section>
          )}

          {view === "kitchen" && (
            <div className="rise-in py-2">
              <h2 className="text-xl font-semibold">Kitchen</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                What you have, what is planned, and what still has to be bought.
              </p>
              <KitchenView
                version={kitchenVersion}
                weekOffset={kitchenWeek}
                onWeekOffsetChange={setKitchenWeek}
                tab={kitchenTab}
                onTabChange={setKitchenTab}
              />
            </div>
          )}

          {view === "run" && (
            <div className="rise-in py-2">
              <h2 className="text-xl font-semibold">Run</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The live turn, every approval waiting on you, and the route behind the answer.
              </p>
              <NoticeBar notice={notice} onDismiss={dismissNotice} />
              <RunView
                statusLabel={isRecording ? "Listening" : run ? STAGE_LABEL[run.stage] : "Idle"}
                turns={messages.length}
                pending={pending}
                proposal={
                  messages[messages.length - 1]?.role === "assistant"
                    ? messages[messages.length - 1]?.screen?.actionProposal
                    : null
                }
                approvalError={approvalError}
                busyId={busyApproval}
                disabled={busy || isRecording}
                onDecide={decideApproval}
              />
            </div>
          )}
        </div>
      </div>

      <nav
        aria-label="Console sections"
        className="fixed inset-x-0 bottom-0 z-30 px-3 lg:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-md items-center gap-1 rounded-full border border-white/[0.08] bg-background/85 p-1.5 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {VIEWS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1 text-[10px] font-medium transition-colors ${
                view === key ? "bg-primary/12 text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="relative">
                <Icon className="size-[18px]" aria-hidden />
                {key === "run" && pending.length > 0 && (
                  <span className="absolute -right-2 -top-1 size-1.5 rounded-full bg-primary" />
                )}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>

      <GeneralSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </main>
  );
}

const LIVE_LABEL: Record<Stage, string> = {
  received: "received your message",
  transcribing: "listening back",
  planning: "planning",
  thinking: "thinking",
  streaming: "typing",
  speaking: "recording voice",
  error: "failed",
};

/** One live bot message that is edited in place as the run moves through each stage. */
function StatusCard({
  run,
  onDismiss,
  onCancel,
  onRetry,
}: {
  run: Run;
  onDismiss: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (run.stage === "error") {
    return (
      <BotBubble sender="Cooksy" at={Date.now()}>
        <p className="stage-chip text-destructive">
          <AlertTriangle className="size-3.5" /> Failed
        </p>
        <p className="mt-2 text-sm text-foreground">{run.error}</p>
        <StepLog steps={run.steps} defaultOpen />
        <InlineKeyboard
          buttons={[
            { key: "retry", label: "↺ Retry", onClick: onRetry },
            { key: "ok", label: "Dismiss", onClick: onDismiss },
          ]}
        />
      </BotBubble>
    );
  }
  return (
    <BotBubble
      sender={`Cooksy${run.sender ? ` · ${run.sender}` : ""}`}
      at={Date.now()}
      edited={run.steps.length > 1}
    >
      {run.heard && run.stage === "transcribing" && (
        <p className="font-mono text-xs text-muted-foreground">
          heard: <span className="text-foreground">{run.heard}</span>
        </p>
      )}
      {run.answer ? (
        <p className="caret whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {run.answer}
        </p>
      ) : run.reasoning ? (
        <p className="line-clamp-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {run.reasoning}
        </p>
      ) : null}
      <p className="mt-1">
        <TypingDots label={LIVE_LABEL[run.stage]} />
      </p>
      <StepLog steps={run.steps} defaultOpen live />
      <InlineKeyboard
        buttons={[{ key: "cancel", label: "✕ Cancel", onClick: onCancel, tone: "danger" }]}
      />
    </BotBubble>
  );
}
