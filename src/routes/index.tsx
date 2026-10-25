import { unlockSpeaker } from "@/lib/voice/speak";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Radio, SlidersHorizontal, Paperclip, SendHorizontal, X as XIcon, RotateCcw, ThumbsUp, ListTree, Volume2, AlertTriangle } from "lucide-react";
import { recordWav, type Recording } from "@/lib/voice/record-wav";
import { streamAgentAnswer, transcribeRecording, type Turn } from "@/lib/voice/agent";
import { transcribeLocal } from "@/lib/voice/local-asr";
import { BotBubble, InlineKeyboard, StepLog, TypingDots, UserBubble, useRunOptions, type RunStep } from "@/components/chat-bubbles";
import { getAgents, speakWith, useVoiceSettings } from "@/lib/settings/voice";
import { GeneralSettings } from "@/components/general-settings";
import { cleanRaw, normalizeText, parseReply, spokenScreen, stripMarkers, type Command, type Screen } from "@/lib/voice/screen";
import { resolveGatewayModel } from "@/lib/ai/models";
import { useApprovals } from "@/lib/cooksy/console";
import { Button } from "@/components/ui/button";
import { KitchenPanel, LifecyclePanel, PagedScreen, Waveform } from "@/components/console-panels";
import darkCodersLogo from "@/assets/darkcoders-logo.png";
import { ACCENTS, clampTheme, useApplyTheme, useTheme, type Accent } from "@/lib/settings/theme";

export const Route = createFileRoute("/")({
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
        content: "A voice console for a kitchen: pantry, week plan and shopping list, with every change gated by your approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoiceConsole,
});

type Stage = "received" | "transcribing" | "planning" | "thinking" | "streaming" | "speaking" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  received: "Received",
  transcribing: "Transcribing",
  planning: "Planning",
  thinking: "Thinking",
  streaming: "Synthesizing",
  speaking: "Speaking",
  error: "Failed",
};


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

  const recordingRef = useRef<Recording | null>(null);
  const startingRef = useRef(false);
  const releaseRef = useRef(false);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const reasoningRef = useRef("");
  const stepsRef = useRef<RunStep[]>([]);
  const [runOptions] = useRunOptions();
  const [voice, setVoice] = useVoiceSettings();
  const settingsRef = useRef({ runOptions, voice });
  settingsRef.current = { runOptions, voice };
  const [speaking, setSpeaking] = useState(false);
  const [standby, setStandby] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const commandRef = useRef<(command: Command) => string | null>(() => null);

  // The approval queue is the source of truth: the console polls cooksy-api through
  // its own server route and never trusts the model's account of what is pending.
  const { pending, error: approvalError, decide } = useApprovals();
  const [busyApproval, setBusyApproval] = useState<string | null>(null);
  const [kitchenVersion, setKitchenVersion] = useState(0);

  const addStep = useCallback((label: string, detail?: string, tone?: RunStep["tone"]) => {
    stepsRef.current = [...stepsRef.current, { label, at: Date.now(), ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) }];
    const steps = stepsRef.current;
    setRun((current) => (current ? { ...current, steps } : current));
  }, []);
  const resetSteps = () => { stepsRef.current = []; };

  const appendMessage = useCallback((message: Message) => {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
    return messagesRef.current;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, run]);

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
      if (!model) throw new Error(`${agentLabel} is not an agent this console can reach. Pick Cook or Planner.`);
      addStep("Agent", `${agentLabel} · ${model}`);
      setRun((current) => (current ? { ...current, sender: agentLabel, answer: "" } : current));

      let thinking = false;
      let writing = false;
      const raw = await streamAgentAnswer(
        turns,
        {
          onThinking: (reasoning) => {
            if (!thinking) { thinking = true; addStep("Thinking"); }
            reasoningRef.current = reasoning;
            setRun((current) => current ? { ...current, reasoning, stage: current.stage === "streaming" ? current.stage : "thinking" } : current);
          },
          onAnswer: (text) => {
            if (!writing) { writing = true; addStep("Writing reply"); }
            if (opts.typing) setRun((current) => (current ? { ...current, answer: stripMarkers(cleanRaw(text)).text, stage: "streaming" } : current));
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
        addStep(result ? "Applied" : "Not available", result ?? `${command.name} ${command.value}`.trim(), result ? undefined : "error");
      }
      if (screen.actionProposal) {
        addStep("Approval waiting", `${normalizeText(screen.actionProposal.title)} · ${screen.actionProposal.tool}`, "warn");
      }
      addStep("Reply ready", `${screen.choices.length} button${screen.choices.length === 1 ? "" : "s"}`);
      if (opts.speak) addStep("Speaking");
      appendMessage({ id: newId(), role: "assistant", text: screen.text, screen, reasoning: reasoningRef.current, at: Date.now(), steps: stepsRef.current, sender: agentLabel });
      setRun(null);
      if (!opts.speak) return;
      try {
        setSpeaking(true);
        await speakWith(voiceSettings, spokenScreen(screen), signal);
      } catch (error) {
        if (!signal.aborted) setNotice(error instanceof Error ? error.message : "The voice engine failed");
      } finally {
        setSpeaking(false);
      }
    },
    [addStep, appendMessage],
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
      setRun({ stage: "planning", heard: text, answer: "", reasoning: "", steps: stepsRef.current });
      void runAgent(history, controller.signal)
        .catch((error) => {
          if (controller.signal.aborted) return setRun(null);
          setRun({ stage: "error", heard: "", answer: "", reasoning: "", error: error instanceof Error ? error.message : "That step failed", steps: stepsRef.current });
        })
        .finally(() => {
          abortRef.current = null;
        });
    },
    [appendMessage, isRecording, run, runAgent],
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
        const onPartial = (partial: string) => setRun((current) => (current ? { ...current, heard: partial } : current));
        const heard = selectedVoice.asrEngine === "local"
          ? await transcribeLocal(file, selectedVoice.asrUrl, selectedVoice.asrModel, onPartial, controller.signal)
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
        setRun({ stage: "error", heard: "", answer: "", reasoning: "", error: message, steps: stepsRef.current });
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
      if (releaseRef.current) { releaseRef.current = false; void stopRecordingRef.current(); }
    } catch {
      startingRef.current = false;
      setRun({
        stage: "error",
        heard: "",
        answer: "",
        reasoning: "",
        steps: stepsRef.current,
        error: "I need microphone access to hear you. Allow it and try again.",
      });
    }
  }, [isRecording, run]);

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) { if (startingRef.current) releaseRef.current = true; return; }
    recordingRef.current = null;
    setIsRecording(false);
    setLevel(0);
    try {
      const file = await recording.stop();
      void finishTurn(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording failed";
      setRun({ stage: "error", heard: "", answer: "", reasoning: "", error: message, steps: stepsRef.current });
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
    setRun({ stage: "planning", heard: lastUser.text, answer: "", reasoning: "", steps: stepsRef.current });
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

  const [view, setView] = useState<"talk" | "kitchen" | "run">("talk");
  const [, setTheme] = useTheme();
  useApplyTheme();
  const busy = Boolean(run) && run?.stage !== "error";

  // Standby: listen hands-free, send after the chosen pause of silence, and wait while the agent talks.
  const standbyRef = useRef({ heard: false, lastLoud: 0 });
  useEffect(() => {
    if (!standby || busy || speaking || isRecording || settingsOpen) return;
    const t = window.setTimeout(() => { standbyRef.current = { heard: false, lastLoud: Date.now() }; void startRecording(); }, 250);
    return () => window.clearTimeout(t);
  }, [standby, busy, speaking, isRecording, settingsOpen, startRecording]);
  useEffect(() => {
    if (!standby || !isRecording) return;
    const t = window.setInterval(() => {
      const lv = recordingRef.current?.level() ?? 0;
      const st = standbyRef.current;
      if (lv > 0.06) { st.heard = true; st.lastLoud = Date.now(); }
      else if (st.heard && Date.now() - st.lastLoud > voice.standbyPause) { st.heard = false; void stopRecording(); }
    }, 80);
    return () => window.clearInterval(t);
  }, [standby, isRecording, voice.standbyPause, stopRecording]);

  const toggleStandby = useCallback(() => {
    setStandby((on) => {
      if (on && recordingRef.current) { recordingRef.current.cancel(); recordingRef.current = null; setIsRecording(false); setLevel(0); }
      return !on;
    });
  }, []);

  // Voice commands: only these reversible controls; returns a confirmation or null if it can't be applied.
  commandRef.current = (command) => {
    const v = command.value.trim().toLowerCase();
    switch (command.name) {
      case "show_tab":
        if (v !== "talk" && v !== "kitchen" && v !== "run") return null;
        setView(v);
        return `Showing ${v === "kitchen" ? "Kitchen" : v === "run" ? "Run" : "Talk"}`;
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
        setTheme((p) => { const next = clampTheme({ ...p, [key]: Number(m[2]) }); applied = next[key]; return next; });
        return `${key === "glass" ? "Glass opacity" : key === "blur" ? "Glass blur" : "Corner roundness"} ${applied || m[2]}`;
      }
      case "open_settings": setSettingsOpen(true); return "General settings opened";
      case "close_settings": setSettingsOpen(false); return "General settings closed";
      case "standby":
        if (v !== "on" && v !== "off") return null;
        if ((v === "on") !== standby) toggleStandby();
        return `Standby ${v}`;
    }
    return null;
  };

  const stopAll = useCallback(() => {
    stopRun();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    setSpeaking(false);
  }, [stopRun]);

  /**
   * Sends the human's decision. cooksy-api is the only thing that executes, and
   * its answer is the only outcome we report — nothing is assumed to have worked.
   */
  const decideApproval = useCallback(async (id: string, decision: "approve" | "deny") => {
    setBusyApproval(id);
    try {
      const outcome = await decide(id, decision);
      if (!outcome) return; // the hook already put the real error on screen
      if (outcome.ok) {
        setNotice(decision === "approve" ? "Approved and run. The kitchen lists now show the result." : "Denied. Nothing was changed.");
        setKitchenVersion((n) => n + 1);
      } else if (outcome.code === "failed") {
        setNotice(`Approved, but the action failed: ${outcome.error ?? "no reason given"}`);
        setKitchenVersion((n) => n + 1);
      } else if (outcome.code === "not_found") {
        setNotice("That approval no longer exists.");
      } else if (outcome.code === "expired") {
        setNotice("That approval expired before it was decided.");
      } else {
        setNotice(`Nothing changed — ${outcome.code.replace(/_/g, " ")}.`);
      }
    } finally {
      setBusyApproval(null);
    }
  }, [decide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); toggleStandby(); }
      if (e.key === "Escape" && !settingsOpen) stopAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleStandby, stopAll, settingsOpen]);

  const submitDraft = () => {
    const text = draft.trim();
    if ((!text && !attachment) || busy || isRecording) return;
    const full = attachment ? `${text || "Please review the attached file."}\n\nAttached file "${attachment.name}":\n${attachment.text}` : text;
    setDraft("");
    setAttachment(null);
    sendText(full);
    inputRef.current?.focus();
  };
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000) return setNotice("That file is too large. Attach a text file under 200 KB.");
    const text = await file.text();
    if (text.includes("\u0000")) return setNotice("Only text files can be attached (txt, md, json, csv, yaml, log).");
    setAttachment({ name: file.name, text: text.slice(0, 20_000) });
  };

  return (
    <main className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-transparent text-foreground">
      <div aria-hidden className="voice-grid pointer-events-none absolute inset-0 opacity-35" />
      <header className="relative z-10 border-b border-white/10 bg-background/55 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center 2xl:max-w-[1800px] justify-between gap-3 px-3 py-3 sm:px-8">
          <img src={darkCodersLogo} alt="Dark Coders" className="h-6 w-auto max-w-[145px] object-contain sm:h-7 sm:max-w-none" />
          <div className="flex shrink-0 items-center gap-2">
            <div role="group" aria-label="Agent" className="glass flex items-center rounded-full p-0.5">
              {Object.entries(getAgents()).map(([id, agent]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={voice.agent === id}
                  onClick={() => setVoice((previous) => ({ ...previous, agent: id }))}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${voice.agent === id ? "border-primary/60 text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {agent.label.replace("Cooksy ", "")}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={toggleStandby} aria-pressed={standby} title="Standby (F9)"
              className={`glass h-10 gap-2 rounded-full px-3 ${standby ? "border-primary/60 text-primary" : "text-foreground"}`}>
              <Radio className={`size-4 ${standby ? "animate-pulse" : ""}`} /> {standby ? "Standing by" : "Standby"}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} aria-label="General settings" title="General settings" className="glass size-10 rounded-full">
              <SlidersHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 gap-4 px-3 py-3 pb-24 sm:px-4 sm:py-4 lg:grid-cols-[260px_minmax(0,1fr)_280px] lg:pb-4 2xl:max-w-[1800px] 2xl:grid-cols-[340px_minmax(0,1fr)_360px] 2xl:gap-6 2xl:text-lg">
      {/* One grid cell for the left column, so the kitchen panel never pushes the
          run/approval panel out of the three-column layout. */}
      <div className="min-w-0 space-y-4 2xl:space-y-5">
        <KitchenPanel key={kitchenVersion} show={view === "kitchen"} />
      </div>
      <div className={`panel ${view === "talk" ? "flex" : "hidden"} lg:flex min-h-[calc(100dvh-10rem)] lg:sticky lg:top-4 lg:h-[calc(100dvh-6.5rem)] lg:min-h-0 min-w-0 flex-col rounded-lg px-4 pb-6 pt-5 sm:px-8 2xl:px-12`}>
      <div className="contents">
      <Waveform level={level} active={isRecording} stage={run?.stage} />

      <div ref={scrollRef} className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && !run && (
           <div className="glass rounded-2xl px-5 py-8 sm:px-7">
            <p className="dc-label">● Ready to listen</p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">Hold the microphone, turn on Standby, or type below to start.</p>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} text={message.text} at={message.at} />
          ) : (
            <div key={message.id} className="space-y-1.5">
              <BotBubble sender={`Cooksy${message.sender ? ` · ${message.sender}` : ""}`} at={message.at}>
                <PagedScreen
                  text={message.text}
                  screen={message.id === messages[messages.length - 1]?.id ? message.screen : undefined}
                  disabled={busy || isRecording}
                  onSend={sendText}
                />
                {message.steps && <StepLog steps={message.steps} defaultOpen={runOptions.expandSteps} />}
              </BotBubble>
              <div className="flex flex-wrap items-center gap-1.5 pl-1">
                <Button variant="ghost" size="sm"
                  onClick={() => {
                    messagesRef.current = messagesRef.current.map((item) =>
                      item.id === message.id ? { ...item, liked: !item.liked } : item,
                    );
                    setMessages(messagesRef.current);
                  }}
                  className={`stage-chip h-auto transition-colors hover:bg-surface-raised ${message.liked ? "text-primary" : ""}`}
                >
                  <ThumbsUp className="size-3.5" /> Useful
                </Button>
                <Button variant="ghost" size="sm" onClick={retry} disabled={busy} className="stage-chip h-auto transition-colors hover:bg-surface-raised disabled:opacity-50">
                  <RotateCcw className="size-3.5" /> Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpenDetails((current) => (current === message.id ? null : message.id))} className="stage-chip h-auto transition-colors hover:bg-surface-raised">
                  <ListTree className="size-3.5" /> Thinking
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setSpeaking(true); void speakWith(voice, message.text).catch((e: unknown) => setNotice(e instanceof Error ? e.message : "The voice engine failed")).finally(() => setSpeaking(false)); }} className="stage-chip h-auto transition-colors hover:bg-surface-raised">
                  <Volume2 className="size-3.5" /> Replay
                </Button>
              </div>
              {openDetails === message.id && (
                <div className="panel p-4">
                  <p className="dc-label text-dc-muted-2">Agent thinking</p>
                  <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                    {message.reasoning?.trim() || "No thinking summary was returned for this answer."}
                  </p>
                </div>
              )}
            </div>
          ),
        )}

        {run && <StatusCard run={run} onDismiss={() => setRun(null)} onCancel={stopRun} />}
      </div>

      {notice && (
        <div role="alert" className="tg-pop mt-3 flex items-start gap-2 rounded-lg border border-destructive/50 bg-surface px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" /><span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted-foreground"><XIcon className="size-3.5" /></button>
        </div>
      )}
      <footer className="mt-4 flex flex-col items-center gap-3">
        <form className="flex w-full max-w-2xl items-end gap-2" onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
          <div className="glass min-w-0 flex-1 rounded-2xl focus-within:border-primary/60">
            {attachment && (
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                <Paperclip className="size-3" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}><XIcon className="size-3" /></button>
              </div>
            )}
            <textarea ref={inputRef} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitDraft(); } }}
              placeholder="Type a message… (Enter to send)" aria-label="Message"
              className="block max-h-32 min-h-12 w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
          <label className="glass flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl text-foreground hover:bg-white/10" aria-label="Attach a text file">
            <Paperclip className="size-5" />
            <input type="file" className="sr-only" accept=".txt,.md,.json,.csv,.yaml,.yml,.log,text/*" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <Button type="submit" disabled={busy || isRecording || (!draft.trim() && !attachment)} aria-label="Send" className="size-12 shrink-0 rounded-2xl">
            <SendHorizontal className="size-5" />
          </Button>
        </form>
        <div className="relative">
          {isRecording && <span className="pulse-ring absolute inset-0 rounded-full bg-primary" />}
          <Button
            variant="default"
            onPointerDown={() => void startRecording()}
            onPointerUp={() => void stopRecording()}
            onPointerLeave={() => isRecording && void stopRecording()}
            disabled={busy}
            aria-label={isRecording ? "Release to send" : "Hold to talk"}
            className="mic-button relative flex size-20 items-center justify-center rounded-full active:scale-95 disabled:opacity-40 [&_svg]:size-8"
            style={isRecording ? { filter: `brightness(${1 + Math.min(level, 0.5)})` } : undefined}
          >
            <Mic className="size-8" />
          </Button>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {isRecording ? (standby ? "standing by… pause to send" : "listening… release to send") : busy ? "agent is running · Esc stop" : speaking ? "speaking · Esc stop" : "hold to talk · F9 standby · Esc stop"}
        </p>
        {(busy || speaking) && (
          <Button variant="outline"
            onClick={stopAll}
            className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
          >
            <Square className="size-3.5" /> Stop
          </Button>
        )}
      </footer>
      </div>
      </div>
      <LifecyclePanel
        statusLabel={isRecording ? "Listening" : run ? STAGE_LABEL[run.stage] : "Idle"}
        turns={messages.length}
        show={view === "run"}
        pending={pending}
        proposal={messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1]?.screen?.actionProposal : null}
        approvalError={approvalError}
        busyId={busyApproval}
        disabled={busy || isRecording}
        onDecide={decideApproval}
      />
      </div>
      <nav aria-label="Console sections" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-border bg-background/55 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
        {([["talk", "◉", "Talk"], ["kitchen", "❖", "Kitchen"], ["run", "◷", "Run"]] as const).map(([key, glyph, label]) => (
          <button key={key} type="button" onClick={() => setView(key)} aria-current={view === key ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs ${view === key ? "text-primary" : "text-muted-foreground"}`}>
            <span aria-hidden className="text-lg leading-none">{glyph}</span>{label}
          </button>
        ))}
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
function StatusCard({ run, onDismiss, onCancel }: { run: Run; onDismiss: () => void; onCancel: () => void }) {
  if (run.stage === "error") {
    return (
      <BotBubble sender="Cooksy" at={Date.now()}>
        <p className="stage-chip text-destructive"><AlertTriangle className="size-3.5" /> Failed</p>
        <p className="mt-2 text-sm text-foreground">{run.error}</p>
        <StepLog steps={run.steps} defaultOpen />
        <InlineKeyboard buttons={[{ key: "ok", label: "Dismiss", onClick: onDismiss }]} />
      </BotBubble>
    );
  }
  return (
    <BotBubble sender={`Cooksy${run.sender ? ` · ${run.sender}` : ""}`} at={Date.now()} edited={run.steps.length > 1}>
      {run.heard && run.stage === "transcribing" && <p className="font-mono text-xs text-muted-foreground">heard: <span className="text-foreground">{run.heard}</span></p>}
      {run.answer ? (
        <p className="caret whitespace-pre-wrap text-sm leading-relaxed text-foreground">{run.answer}</p>
      ) : run.reasoning ? (
        <p className="line-clamp-3 font-mono text-xs leading-relaxed text-muted-foreground">{run.reasoning}</p>
      ) : null}
      <p className="mt-1"><TypingDots label={LIVE_LABEL[run.stage]} /></p>
      <StepLog steps={run.steps} defaultOpen live />
      <InlineKeyboard buttons={[{ key: "cancel", label: "✕ Cancel", onClick: onCancel, tone: "danger" }]} />
    </BotBubble>
  );
}
