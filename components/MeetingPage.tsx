"use client";

import { useState, useRef, Suspense, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, FileText } from "lucide-react";
import { TEACHER_UID } from "@/lib/agora";
import type { RTMClient } from "agora-rtm";
import type {
  AgoraTokenData,
  ClientStartRequest,
  AgentResponse,
  AgoraRenewalTokens,
  UserSession,
} from "../types/conversation";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { ClassroomModeControl } from "./ClassroomModeControl";
import type { AiMode } from "@/lib/sona/types";
import {
  AgoraVoiceAI,
  ChatMessageType,
  ChatMessagePriority,
} from "agora-agent-client-toolkit";
import { SUMMARY_PROMPT } from "@/lib/prompts";
import { supabase } from "@/lib/supabaseClient";

// Dynamically import the ConversationComponent with ssr disabled
const ConversationComponent = dynamic(() => import("./ConversationComponent"), {
  ssr: false,
});

// Dynamically import AgoraRTCProvider (browser-only).
const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } =
      await import("agora-rtc-react");
    return {
      default: function AgoraProviders({
        children,
      }: {
        children: React.ReactNode;
      }) {
        const clientRef = useRef<ReturnType<
          typeof AgoraRTC.createClient
        > | null>(null);
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({
            mode: "rtc",
            codec: "vp8",
          });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>
            {children}
          </AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

export default function MeetingPage() {
  const router = useRouter();
  const [showConversation, setShowConversation] = useState(false);
  const [isAnimationComplete, setIsAnimationComplete] = useState(false);
  const [userSession, setUserSession] = useState<UserSession | null>(null);
  const [mounted, setMounted] = useState(false);

  // Preload heavy modules on mount
  useEffect(() => {
    import("agora-rtc-react").catch(() => {});
    import("agora-rtm").catch(() => {});
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null);
  const [rtmClient, setRtmClient] = useState<RTMClient | null>(null);
  const [agentJoinError, setAgentJoinError] = useState(false);
  /**
   * The teacher's permission level for SonaAI.
   *
   * ASK is the default on purpose: the first thing a teacher sees should be SonaAI asking,
   * not SonaAI talking. Students receive this over RTM and display it read-only.
   */
  const [aiMode, setAiMode] = useState<AiMode>("ASK");
  const [isAiModeBusy, setIsAiModeBusy] = useState(false);

  // Summary flow state
  type SummaryState = "idle" | "requesting" | "waiting" | "ready" | "error";
  const [summaryState, setSummaryState] = useState<SummaryState>("idle");
  const [summaryText, setSummaryText] = useState<string>("");
  const [studentExercise, setStudentExercise] = useState<{
    prompt: string;
    concept: string;
  } | null>(null);
  const [studentAnswer, setStudentAnswer] = useState("");
  const [studentExerciseResult, setStudentExerciseResult] = useState<
    "idle" | "correct" | "retry"
  >("idle");
  // summaryModeRef is a shared mutable ref passed to ConversationComponent directly.
  // Setting .current = true synchronously before calling inject-think eliminates the
  // async gap where an agent response could arrive before the prop update propagated.
  const summaryModeRef = useRef(false);
  const summaryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionTranscriptLog = useRef<
    import("@/types/conversation").TranscriptTurn[]
  >([]);

  // Step 1 — read session from sessionStorage and set mounted/userSession.
  // Harmless to run twice (StrictMode): just parses and sets state, no side-effects.
  useEffect(() => {
    setMounted(true);
    const stored = sessionStorage.getItem("echosphere_meeting");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const session: UserSession = {
          name: parsed.name,
          role: parsed.role,
          classroomCode: parsed.classroomCode,
        };
        setUserSession(session);
      } catch {
        router.push("/dashboard");
      }
    } else {
      const joinCode = new URLSearchParams(window.location.search).get("join");
      if (!joinCode) {
        router.push("/dashboard");
        return;
      }

      void supabase.auth
        .getSession()
        .then(({ data: { session: supaSession } }) => {
          if (!supaSession) {
            router.push(`/auth?join=${encodeURIComponent(joinCode)}`);
            return;
          }

          const session: UserSession = {
            name:
              supaSession.user.user_metadata?.name ??
              supaSession.user.user_metadata?.full_name ??
              supaSession.user.email?.split("@")[0] ??
              "Student",
            role: "student",
            classroomCode: joinCode.trim().toUpperCase(),
          };
          sessionStorage.setItem("echosphere_meeting", JSON.stringify(session));
          setUserSession(session);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2 — StrictMode guard, identical to ConversationComponent's isReady pattern.
  // React StrictMode fires cleanup synchronously before any setTimeout callback, so
  // the first (fake) mount's timeout is always cancelled. Only the real second mount's
  // timeout fires, meaning handleJoinInternal is called exactly once.
  // In production builds StrictMode double-invocation does not happen, so the guard
  // is a no-op there — the single real mount sets isReady=true normally.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  // Step 3 — auto-join only once both the session is read AND the StrictMode guard clears.
  // Gating on isReady ensures RTM login is never called twice in quick succession.
  const joinFiredRef = useRef(false);
  useEffect(() => {
    if (!isReady || !userSession || joinFiredRef.current) return;
    joinFiredRef.current = true;
    void handleJoinInternal(userSession);
  }, [isReady, userSession]);

  const handleTranscriptTurn = useCallback(
    (turn: import("@/types/conversation").TranscriptTurn) => {
      sessionTranscriptLog.current = [...sessionTranscriptLog.current, turn];
    },
    [],
  );

  const handleAgentId = useCallback((agentId: string) => {
    setAgoraData((prev) =>
      prev && !prev.agentId ? { ...prev, agentId } : prev,
    );
  }, []);

  const handleJoinInternal = async (session: UserSession) => {
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    try {
      const tokenUrl =
        session.role === "teacher"
          ? `/api/generate-agora-token?channel=${encodeURIComponent(session.classroomCode)}&uid=${TEACHER_UID}`
          : `/api/generate-agora-token?channel=${encodeURIComponent(session.classroomCode)}&role=student`;

      const agoraResponse = await fetch(tokenUrl);
      const responseData = await agoraResponse.json();

      if (!agoraResponse.ok) {
        throw new Error(
          `Failed to generate Agora token: ${JSON.stringify(responseData)}`,
        );
      }

      let agentData: AgentResponse | null = null;

      if (session.role === "teacher") {
        const [inviteResult, rtmResult] = await Promise.all([
          fetch("/api/invite-agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requester_id: responseData.uid,
              channel_name: responseData.channel,
              user_name: session.name,
              user_role: session.role,
            } as ClientStartRequest),
          })
            .then(async (res) => {
              if (!res.ok) {
                setAgentJoinError(true);
                return null;
              }
              return res.json() as Promise<AgentResponse>;
            })
            .catch((err) => {
              console.error("Failed to start conversation with agent:", err);
              setAgentJoinError(true);
              return null;
            }),

          (async () => {
            const { default: AgoraRTM } = await import("agora-rtm");
            const rtmClient: RTMClient = new AgoraRTM.RTM(
              process.env.NEXT_PUBLIC_AGORA_APP_ID!,
              responseData.uid,
            );
            await rtmClient.login({ token: responseData.token });
            await rtmClient.subscribe(responseData.channel);
            return rtmClient;
          })(),
        ]);

        agentData = inviteResult;
        setRtmClient(rtmResult);

        if (inviteResult?.agent_id && rtmResult) {
          const agentSessionMsg = JSON.stringify({
            type: "agent_session",
            agent_id: inviteResult.agent_id,
          });
          rtmResult
            .publish(responseData.channel, agentSessionMsg)
            .catch((err) =>
              console.warn("[agent_session] RTM publish failed:", err),
            );
          // RTM Storage/metadata is not enabled on every Agora project. The agent_id
          // broadcast above is the primary discovery path; metadata is optional.
        }
      } else {
        const { default: AgoraRTM } = await import("agora-rtm");
        const studentRtm: RTMClient = new AgoraRTM.RTM(
          process.env.NEXT_PUBLIC_AGORA_APP_ID!,
          responseData.uid,
        );
        await studentRtm.login({ token: responseData.token });
        await studentRtm.subscribe(responseData.channel);

        // FIX 3: immediately request the agent_id from whoever is already in the channel.
        // This fires AFTER subscribe completes, so the teacher's client will receive it
        // and re-publish agent_session in response — works regardless of join order.
        studentRtm
          .publish(
            responseData.channel,
            JSON.stringify({ type: "request_agent_id" }),
          )
          .catch(() => {
            /* non-fatal */
          });

        // Do not depend on RTM Storage metadata. The teacher responds to the
        // request_agent_id message after this client subscribes.

        setRtmClient(studentRtm);
      }

      setAgoraData({ ...responseData, agentId: agentData?.agent_id });
      setShowConversation(true);
    } catch (err) {
      setError("Failed to join classroom. Please try again.");
      console.error("Error joining classroom:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTokenWillExpire = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      try {
        const channel = agoraData?.channel;
        if (!channel) {
          throw new Error("Missing channel for token renewal");
        }

        const [rtcResponse, rtmResponse] = await Promise.all([
          fetch(`/api/generate-agora-token?channel=${channel}&uid=${uid}`),
          fetch(
            `/api/generate-agora-token?channel=${channel}&uid=${agoraData.uid}`,
          ),
        ]);
        const [rtcData, rtmData] = await Promise.all([
          rtcResponse.json(),
          rtmResponse.json(),
        ]);

        if (!rtcResponse.ok || !rtmResponse.ok) {
          throw new Error("Failed to generate renewal tokens");
        }

        return {
          rtcToken: rtcData.token,
          rtmToken: rtmData.token,
        };
      } catch (error) {
        console.error("Error renewing token:", error);
        throw error;
      }
    },
    [agoraData],
  );

  const handleSummaryTurn = useCallback((text: string) => {
    if (summaryTimeoutRef.current) {
      clearTimeout(summaryTimeoutRef.current);
      summaryTimeoutRef.current = null;
    }
    setSummaryText(text);
    summaryModeRef.current = false; // reset the shared ref
    setSummaryState("ready");
  }, []);

  const handleEndClassAndSummary = useCallback(async () => {
    const fallbackSummary = () => {
      const turns = sessionTranscriptLog.current;
      const transcript = turns.map((turn) => turn.text).join(" ");
      const lower = transcript.toLowerCase();
      const concept = lower.includes("newton")
        ? "Newton's Second Law"
        : lower.includes("acceleration")
          ? "acceleration"
          : lower.includes("force")
            ? "force"
            : "the current lesson";
      const studentQuestions = turns.filter(
        (turn) =>
          turn.role === "student" &&
          (turn.text.includes("?") ||
            /doubt|confus|understand|repeat/i.test(turn.text)),
      );
      const students = [...new Set(studentQuestions.map((turn) => turn.name))];
      return [
        "OVERALL SUMMARY",
        `The class discussed ${concept}. SonaAI observed the live transcript and waited for teacher approval before offering help.`,
        "",
        "COMMON LEARNING GAPS",
        studentQuestions.length > 0
          ? `${concept} needs one more worked example and a short check for understanding.`
          : "None identified.",
        "",
        "STUDENTS NEEDING SUPPORT",
        students.length > 0
          ? students
              .map(
                (name) =>
                  `${name}: asked a question or expressed uncertainty during the lesson.`,
              )
              .join("\n")
          : "None identified.",
      ].join("\n");
    };

    if (!agoraData?.agentId) {
      setSummaryText(fallbackSummary());
      setSummaryState("ready");
      return;
    }
    setSummaryState("requesting");
    // FIX 2: set the shared ref synchronously BEFORE the fetch, so
    // ConversationComponent sees summaryMode=true on the same tick the agent
    // response arrives — no async prop-propagation gap.
    summaryModeRef.current = true;
    try {
      const transcriptLog = sessionTranscriptLog.current
        .map((t) => `[${t.role} - ${t.name}]: ${t.text}`)
        .join("\n");

      const promptText = `Here is the full transcript of the class:\n\n${transcriptLog}\n\n${SUMMARY_PROMPT}`;

      const ai = AgoraVoiceAI.getInstance();
      if (!ai) throw new Error("AI not initialized");

      // We use the frontend RTM connection instead of the REST API to bypass
      // the need for HTTP Basic Auth (Customer ID/Secret) which causes the 401.
      await ai.sendText(agoraData.agentId, {
        messageType: ChatMessageType.TEXT,
        text: promptText,
        priority: ChatMessagePriority.INTERRUPTED,
        responseInterruptable: false,
      });
      setSummaryState("waiting");

      summaryTimeoutRef.current = setTimeout(() => {
        summaryModeRef.current = false;
        setSummaryText(fallbackSummary());
        setSummaryState("ready");
      }, 60000);
    } catch (err) {
      console.error("Failed to request summary:", err);
      summaryModeRef.current = false;
      setSummaryText(fallbackSummary());
      setSummaryState("ready");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraData]);

  const handleEndStudentSession = useCallback(() => {
    const transcript = sessionTranscriptLog.current
      .map((turn) => turn.text)
      .join(" ");
    const lower = transcript.toLowerCase();
    const concept = lower.includes("newton")
      ? "Newton's Second Law"
      : lower.includes("acceleration")
        ? "acceleration"
        : lower.includes("force")
          ? "force"
          : "the main idea from today's lesson";
    const prompt =
      concept === "Newton's Second Law"
        ? "If the force stays the same but the mass doubles, what happens to acceleration, and why?"
        : `In your own words, explain one important idea you learned about ${concept}.`;
    setStudentExercise({ prompt, concept });
    setStudentAnswer("");
    setStudentExerciseResult("idle");
  }, []);

  const submitStudentExercise = useCallback(() => {
    const answer = studentAnswer.trim().toLowerCase();
    const correct =
      studentExercise?.concept === "Newton's Second Law"
        ? answer.includes("half") ||
          answer.includes("decrease") ||
          answer.includes("less")
        : answer.length >= 12;
    setStudentExerciseResult(correct ? "correct" : "retry");
  }, [studentAnswer, studentExercise]);

  const handleDownloadSummary = useCallback(async () => {
    if (!summaryText || !userSession) return;
    const { parseSummaryText, downloadSummaryPdf } =
      await import("@/lib/summary-pdf");
    const parsed = parseSummaryText(summaryText);
    await downloadSummaryPdf(
      parsed,
      userSession.classroomCode,
      userSession.name,
    );
  }, [summaryText, userSession]);

  const handleDismissSummaryAndEnd = useCallback(async () => {
    summaryModeRef.current = false;
    setSummaryState("idle");
    setSummaryText("");
    if (summaryTimeoutRef.current) {
      clearTimeout(summaryTimeoutRef.current);
      summaryTimeoutRef.current = null;
    }
    await handleEndConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Move the AUTO / ASK / MUTE dial.
   *
   * AUTO and ASK are policy, enforced by the intervention engine on the teacher's client.
   * MUTE is different, and this is the honest part: the Agora managed agent runs its own
   * listen→think→speak loop over the channel audio, so no amount of client-side policy can
   * stop it answering a student who addresses it. To make "SonaAI will not speak" true we end
   * the agent session, and starting a new one when the teacher un-mutes.
   */
  const handleAiModeChange = useCallback(
    async (next: AiMode) => {
      if (isAiModeBusy || next === aiMode) return;

      const wasMuted = aiMode === "MUTE";
      const willMute = next === "MUTE";
      const syncServerMode = async () => {
        if (!agoraData?.channel) return;
        const response = await fetch("/api/sona-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: agoraData.channel, mode: next }),
        });
        if (!response.ok) throw new Error(await response.text());
      };

      // Nothing to start or stop between AUTO and ASK — the engine reads the mode directly.
      if (!willMute && !wasMuted) {
        await syncServerMode();
        setAiMode(next);
        return;
      }

      setIsAiModeBusy(true);
      try {
        if (willMute) {
          if (agoraData?.agentId) {
            await fetch("/api/stop-conversation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agent_id: agoraData.agentId }),
            });
            setAgoraData((prev) =>
              prev ? { ...prev, agentId: undefined } : prev,
            );
          }
          await syncServerMode();
          setAiMode(next);
        } else {
          // Leaving MUTE: bring SonaAI back into the channel.
          if (!agoraData || !userSession) return;
          const res = await fetch("/api/invite-agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requester_id: agoraData.uid,
              channel_name: agoraData.channel,
              user_name: userSession.name,
              user_role: userSession.role,
            } as ClientStartRequest),
          });
          if (!res.ok) {
            console.error("Failed to restart AI agent:", await res.text());
            return; // stay MUTE rather than claim a mode we did not reach
          }
          const data = (await res.json()) as AgentResponse;
          await syncServerMode();
          setAgoraData((prev) =>
            prev ? { ...prev, agentId: data.agent_id } : prev,
          );
          setAiMode(next);
          rtmClient
            ?.publish(
              agoraData.channel,
              JSON.stringify({
                type: "agent_session",
                agent_id: data.agent_id,
              }),
            )
            .catch(() => {
              /* students will ask for it if they missed this */
            });
        }
      } catch (err) {
        console.error("Failed to change SonaAI mode:", err);
      } finally {
        setIsAiModeBusy(false);
      }
    },
    [aiMode, isAiModeBusy, agoraData, userSession, rtmClient],
  );

  useEffect(() => {
    if (!agoraData?.channel || userSession?.role !== "teacher") return;
    fetch("/api/sona-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: agoraData.channel, mode: aiMode }),
    }).catch((error) =>
      console.warn("[sona-mode] initial sync failed:", error),
    );
  }, [agoraData?.channel, userSession?.role]);

  // Keep everyone's UI in agreement about what SonaAI is allowed to do. Fires on the initial
  // ASK as well, so a student who joins later is told the mode rather than assuming one.
  useEffect(() => {
    if (!rtmClient || !agoraData || userSession?.role !== "teacher") return;
    rtmClient
      .publish(
        agoraData.channel,
        JSON.stringify({ type: "ai_mode", mode: aiMode }),
      )
      .catch((err) => console.warn("[ai_mode] RTM publish failed:", err));
  }, [aiMode, rtmClient, agoraData, userSession?.role]);

  // FIX 3: Teacher responds when a student requests the current agent_id via RTM.
  // This is the primary reliable mechanism for late-joining students to get agentId,
  // since it doesn't depend on message timing or the storage feature.
  const handleRequestAgentId = useCallback(() => {
    if (!rtmClient || !agoraData) return;
    // Answer with the current mode too — a student that just arrived has no idea whether
    // SonaAI is muted, and an empty AI tile with no explanation looks like a failure.
    rtmClient
      .publish(
        agoraData.channel,
        JSON.stringify({ type: "ai_mode", mode: aiMode }),
      )
      .catch(() => {
        /* non-fatal */
      });
    if (!agoraData.agentId) return;
    const msg = JSON.stringify({
      type: "agent_session",
      agent_id: agoraData.agentId,
    });
    rtmClient
      .publish(agoraData.channel, msg)
      .catch((err) => console.warn("[agent_session] re-publish failed:", err));
  }, [agoraData, rtmClient, aiMode]);

  const handleEndConversation = async () => {
    if (agoraData?.agentId) {
      try {
        const response = await fetch("/api/stop-conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: agoraData.agentId }),
        });
        if (!response.ok) {
          console.error("Failed to stop agent:", await response.text());
        }
      } catch (error) {
        console.error("Error stopping agent:", error);
      }
    }

    rtmClient?.logout().catch((err) => console.error("RTM logout error:", err));
    setRtmClient(null);
    setShowConversation(false);
    sessionTranscriptLog.current = [];
    sessionStorage.removeItem("echosphere_meeting");
    router.push("/dashboard");
  };

  if (!mounted) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--es-page-bg)" }}
      >
        <div
          className="animate-pulse-subtle text-sm"
          style={{ color: "var(--es-text-muted)" }}
        >
          Loading…
        </div>
      </div>
    );
  }

  // Pre-join loading state
  if (!showConversation || !isAnimationComplete) {
    const glassPanel = {
      background: "rgba(255, 255, 255, 0.6)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      border: "1px solid rgba(255, 255, 255, 0.4)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
    };

    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 bg-cover bg-center bg-no-repeat bg-fixed relative"
        style={{ backgroundImage: 'url("/Teacher-Dashboard.png")' }}
      >
        {/* Logo */}
        <div className="absolute top-6 left-6 md:left-8 z-50 flex items-center gap-2.5">
          <img
            src="/SonaAI%20icon1.png"
            alt="SonaAI Logo"
            className="h-9 w-9 object-contain bg-white p-1"
            style={{
              borderRadius: "12px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}
          />
          <span
            className="text-xl font-extrabold tracking-tight"
            style={{
              color: "#031A10",
              fontFamily: "var(--font-manrope)",
            }}
          >
            SonaAI
          </span>
        </div>

        <div
          className="animate-slide-up-enter flex flex-col items-center rounded-[32px] p-10 text-center shadow-2xl max-w-md w-full"
          style={glassPanel}
        >
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-2xl shadow-lg overflow-hidden bg-[#031A10]">
            <video
              src="/Loading.webm"
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
              onEnded={() => setIsAnimationComplete(true)}
            />
          </div>

          {isLoading ? (
            <>
              <Loader2
                className="mb-4 h-8 w-8 animate-spin"
                style={{ color: "#031A10" }}
              />
              <p
                className="text-2xl font-extrabold font-manrope"
                style={{ color: "#031A10" }}
              >
                Joining classroom…
              </p>
              <p
                className="mt-2 text-sm font-medium"
                style={{ color: "rgba(3, 26, 16, 0.6)" }}
              >
                Setting up your audio and connecting to the room
              </p>
            </>
          ) : error ? (
            <>
              <p
                className="text-2xl font-extrabold font-manrope"
                style={{ color: "#031A10" }}
              >
                Connection Failed
              </p>
              <p
                className="mt-2 text-sm font-medium"
                style={{ color: "#dc2626" }}
              >
                {error}
              </p>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="mt-6 rounded-full px-8 py-3 text-sm font-bold shadow-lg transition-transform hover:scale-105"
                style={{ background: "#031A10", color: "#D0FFA2" }}
              >
                Back to Dashboard
              </button>
            </>
          ) : (
            <>
              <p
                className="text-2xl font-extrabold font-manrope"
                style={{ color: "#031A10" }}
              >
                Preparing classroom…
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col items-stretch justify-start">
        <div className="z-10 flex min-h-0 flex-1 flex-col h-full w-full max-w-none items-stretch gap-0 px-0 text-left">
          {agoraData && rtmClient && userSession ? (
            <>
              {agentJoinError && (
                <div className="p-3 bg-destructive/10 rounded-md text-destructive text-sm max-w-sm mx-auto mt-2">
                  Failed to connect with AI agent. The conversation may not work
                  as expected.
                </div>
              )}
              <Suspense fallback={<LoadingSkeleton />}>
                <ErrorBoundary>
                  <AgoraProvider>
                    <ConversationComponent
                      agoraData={agoraData}
                      rtmClient={rtmClient}
                      userSession={userSession}
                      teacherControls={
                        userSession.role === "teacher" ? (
                          <ClassroomModeControl
                            mode={aiMode}
                            onChange={(next) => void handleAiModeChange(next)}
                            isBusy={isAiModeBusy}
                          />
                        ) : undefined
                      }
                      aiMode={aiMode}
                      onRemoteAiMode={
                        userSession.role === "student" ? setAiMode : undefined
                      }
                      onTranscriptTurn={handleTranscriptTurn}
                      onAgentId={handleAgentId}
                      onSummaryTurn={handleSummaryTurn}
                      summaryModeRef={summaryModeRef}
                      onRequestAgentId={
                        userSession.role === "teacher"
                          ? handleRequestAgentId
                          : undefined
                      }
                      onTokenWillExpire={handleTokenWillExpire}
                      onEndConversation={
                        // The teacher's exit runs the post-class summary first; a student
                        // leaving just leaves. Without this the summary flow was unreachable.
                        userSession.role === "teacher"
                          ? () => void handleEndClassAndSummary()
                          : handleEndStudentSession
                      }
                    />
                  </AgoraProvider>
                </ErrorBoundary>
              </Suspense>
            </>
          ) : (
            <p className="text-sm text-muted-foreground p-4">
              Failed to load conversation data.
            </p>
          )}
        </div>
      </div>

      {/* Summary modal */}
      {userSession &&
        userSession.role === "teacher" &&
        summaryState !== "idle" && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(8px)",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Post-class summary"
          >
            <div
              className="w-full max-w-lg rounded-[var(--es-radius-xl)] p-6 space-y-4"
              style={{
                background: "var(--es-panel-bg)",
                border: "1px solid var(--es-border-subtle)",
              }}
            >
              <div className="flex items-center gap-2">
                <FileText
                  className="h-5 w-5 shrink-0"
                  style={{ color: "var(--es-text-primary)" }}
                />
                <h2
                  className="text-lg font-semibold"
                  style={{ color: "var(--es-text-primary)" }}
                >
                  Post-Class Summary
                </h2>
              </div>

              {summaryState === "requesting" || summaryState === "waiting" ? (
                <div
                  className="flex items-center gap-3 rounded-[var(--es-radius-md)] p-4"
                  style={{
                    background: "var(--es-panel-bg-2)",
                    border: "1px solid var(--es-border-subtle)",
                  }}
                >
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin"
                    style={{ color: "var(--es-text-primary)" }}
                  />
                  <p
                    className="text-sm"
                    style={{ color: "var(--es-text-muted)" }}
                  >
                    SonaAI is reading back the class transcript and writing your
                    summary. This usually takes a few seconds.
                  </p>
                </div>
              ) : summaryState === "error" ? (
                <p className="text-sm" style={{ color: "#dc2626" }}>
                  The summary timed out or failed to generate. You can still
                  download the raw transcript or end the class.
                </p>
              ) : (
                <div
                  className="max-h-64 overflow-y-auto rounded-[var(--es-radius-md)] p-3"
                  style={{
                    background: "var(--es-panel-bg-2)",
                    border: "1px solid var(--es-border-subtle)",
                  }}
                >
                  <pre
                    className="whitespace-pre-wrap text-xs leading-relaxed"
                    style={{
                      color: "var(--es-text-primary)",
                      fontFamily: "var(--font-inter), sans-serif",
                    }}
                  >
                    {summaryText}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                {summaryState === "ready" && (
                  <button
                    type="button"
                    onClick={handleDownloadSummary}
                    className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      background: "var(--es-action-primary)",
                      color: "var(--es-on-primary)",
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    Download Summary (PDF)
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismissSummaryAndEnd}
                  className="rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-70"
                  style={{
                    color: "var(--es-text-muted)",
                    border: "1px solid var(--es-border-subtle)",
                  }}
                >
                  {summaryState === "ready"
                    ? "End Class"
                    : summaryState === "error"
                      ? "End Class Anyway"
                      : "Skip Summary & End Class"}
                </button>
              </div>
            </div>
          </div>
        )}

      {userSession?.role === "student" && studentExercise && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Post-class exercise"
        >
          <div className="w-full max-w-lg space-y-4 rounded-3xl bg-[#052329] p-6 text-white shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-wider text-[#D0FFA2]">
              One-minute check
            </p>
            <h2 className="text-2xl font-bold">Show what you understood</h2>
            <p className="text-base leading-relaxed text-white/80">
              {studentExercise.prompt}
            </p>
            <textarea
              value={studentAnswer}
              onChange={(event) => setStudentAnswer(event.target.value)}
              disabled={studentExerciseResult === "correct"}
              className="min-h-28 w-full rounded-2xl border border-white/15 bg-white/10 p-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#D0FFA2]"
              placeholder="Write your answer..."
            />
            {studentExerciseResult === "correct" && (
              <p className="text-sm font-semibold text-[#D0FFA2]">
                Nice work. Your response matches the key idea.
              </p>
            )}
            {studentExerciseResult === "retry" && (
              <p className="text-sm font-semibold text-amber-300">
                Try once more using the relationship between force, mass, and
                acceleration.
              </p>
            )}
            <div className="flex justify-end gap-3">
              {studentExerciseResult !== "correct" && (
                <button
                  type="button"
                  onClick={submitStudentExercise}
                  disabled={!studentAnswer.trim()}
                  className="rounded-full bg-[#D0FFA2] px-5 py-2.5 text-sm font-bold text-[#031A10] disabled:opacity-50"
                >
                  Check answer
                </button>
              )}
              <button
                type="button"
                onClick={handleEndConversation}
                className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/80"
              >
                {studentExerciseResult === "correct" ? "Leave class" : "Skip"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
