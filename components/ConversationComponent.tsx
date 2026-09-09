"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import AgoraRTC, {
  useRTCClient,
  useLocalMicrophoneTrack,
  useRemoteUsers,
  useClientEvent,
  useJoin,
  usePublish,
  UID,
} from "agora-rtc-react";
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  ChatMessageType,
  ChatMessagePriority,
  MessageSalStatus,
  TranscriptHelperMode,
  TurnStatus,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from "agora-agent-client-toolkit";
import { SonaAIExpression } from "@/components/SonaAIExpression";
import { Loader2, Mic, MicOff, SendHorizontal } from "lucide-react";
import { DEFAULT_AGENT_UID } from "@/lib/agora";
import {
  getCurrentInProgressMessage,
  getMessageList,
  mapAgentVisualizerState,
  normalizeTimestampMs,
  normalizeTranscript,
} from "@/lib/conversation";
import { MicrophoneSelector } from "./MicrophoneSelector";
import {
  getConversationIssueSeverity,
  type ConnectionIssue,
} from "./ConversationErrorCard";
import { ConnectionStatusPanel } from "./ConnectionStatusPanel";
import { ClassroomConversationLayout } from "./ClassroomConversationLayout";
import {
  ClassroomPipelineMetrics,
  type ClassroomAgentMetric,
} from "./ClassroomPipelineMetrics";
import { ClassroomTranscriptPanel } from "./ClassroomTranscriptPanel";
import { ClassroomAiStateBadge } from "./ClassroomAiStateBadge";
import { ClassroomInterventionCard } from "./ClassroomInterventionCard";
import { ClassroomSignalPanel } from "./ClassroomSignalPanel";
import { useInterventionEngine } from "@/hooks/useInterventionEngine";
import type { AiMode, InterventionDecision } from "@/lib/sona/types";
import type {
  ConversationComponentProps,
  TranscriptTurn,
  ParticipantPresence,
} from "@/types/conversation";

// Cap the displayed issues list to avoid overwhelming the UI during a cascade of errors.
const MAX_CONNECTION_ISSUES = 6;

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

// Payload shape for signaling-level errors forwarded by the agent over RTM.
// The `module` field identifies which backend subsystem (LLM / ASR / TTS) raised the error.
type RtmMessageErrorPayload = {
  object: "message.error";
  module?: string;
  code?: number;
  message?: string;
  send_ts?: number;
};

// Payload shape for SAL (Session Abstraction Layer) registration status messages.
// VP_REGISTER_FAIL and VP_REGISTER_DUPLICATE indicate RTM channel subscription problems.
type RtmSalStatusPayload = {
  object: "message.sal_status";
  status?: string;
  timestamp?: number;
};

// Type guard for RTM signaling-level error payloads (object: 'message.error').
function isRtmMessageErrorPayload(
  value: unknown,
): value is RtmMessageErrorPayload {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { object?: unknown }).object === "message.error"
  );
}

// Type guard for RTM SAL status payloads (object: 'message.sal_status').
function isRtmSalStatusPayload(value: unknown): value is RtmSalStatusPayload {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { object?: unknown }).object === "message.sal_status"
  );
}

// Type guard for session transcript turn broadcasts (type: 'transcript_turn').
function isTranscriptTurnPayload(
  value: unknown,
): value is TranscriptTurn & { type: "transcript_turn" } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "transcript_turn"
  );
}

// Payload the teacher broadcasts whenever the AUTO / ASK / MUTE dial moves, so every
// participant's UI reflects the permission the teacher actually granted.
function isAiModePayload(
  value: unknown,
): value is { type: "ai_mode"; mode: AiMode } {
  if (!value || typeof value !== "object") return false;
  if ((value as { type?: unknown }).type !== "ai_mode") return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "AUTO" || mode === "ASK" || mode === "MUTE";
}

export default function ConversationComponent({
  agoraData,
  rtmClient,
  userSession,
  teacherControls,
  aiMode = "ASK",
  onRemoteAiMode,
  onTranscriptTurn,
  onSummaryTurn,
  summaryModeRef,
  onAgentId,
  onRequestAgentId,
  onTokenWillExpire,
  onEndConversation,
}: ConversationComponentProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isEnabled, setIsEnabled] = useState(true);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [isConnectionDetailsOpen, setIsConnectionDetailsOpen] = useState(false);

  // Stable ref for the user's session identity (name, role, classroomCode).
  const _userSessionRef = useRef(userSession);

  // Tracks turn_ids that have already been broadcast to avoid double-sending.
  const broadcastedTurnIds = useRef(new Set<number>());

  // Assigned from the intervention engine further down. The transcript and RTM effects capture
  // this ref rather than the callback itself, so they never re-register (and never re-join the
  // channel) when the engine's identity changes.
  const ingestTurnRef = useRef<((turn: TranscriptTurn) => void) | null>(null);

  // Stable ref for onTranscriptTurn — avoids re-registering RTM listeners when
  // the callback identity changes (e.g. on every LandingPage render).
  const onTranscriptTurnRef = useRef(onTranscriptTurn);
  useEffect(() => {
    onTranscriptTurnRef.current = onTranscriptTurn;
  }, [onTranscriptTurn]);
  // Stable refs for summary capture.
  const onSummaryTurnRef = useRef(onSummaryTurn);
  useEffect(() => {
    onSummaryTurnRef.current = onSummaryTurn;
  }, [onSummaryTurn]);
  // summaryModeRef is a shared mutable ref passed directly from the parent —
  // no local mirroring needed. The parent sets .current = true synchronously
  // before calling inject-think, so we read the same object with no async gap.
  // summaryCaptured tracks whether we've already captured a summary turn in the
  // current summary attempt. It is reset to false when summaryModeRef.current
  // transitions to true (i.e. at the START of each new summary attempt).
  const summaryCaptured = useRef(false);
  const prevSummaryModeRef = useRef(false);
  useEffect(() => {
    const current = summaryModeRef?.current ?? false;
    if (current && !prevSummaryModeRef.current) {
      // summaryMode just became true — reset capture flag for this new attempt.
      summaryCaptured.current = false;
    }
    prevSummaryModeRef.current = current;
  });

  // Stable refs for onAgentId and onRequestAgentId.
  const onAgentIdRef = useRef(onAgentId);
  useEffect(() => {
    onAgentIdRef.current = onAgentId;
  }, [onAgentId]);
  const onRequestAgentIdRef = useRef(onRequestAgentId);
  useEffect(() => {
    onRequestAgentIdRef.current = onRequestAgentId;
  }, [onRequestAgentId]);
  const onRemoteAiModeRef = useRef(onRemoteAiMode);
  useEffect(() => {
    onRemoteAiModeRef.current = onRemoteAiMode;
  }, [onRemoteAiMode]);

  // Tracks granular RTC connection state for the status dot.
  // Agora states: DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | RECONNECTING
  const [connectionState, setConnectionState] = useState<string>("CONNECTING");
  const agentUID = String(DEFAULT_AGENT_UID);
  const [joinedUID, setJoinedUID] = useState<UID>(0);
  const [participants, setParticipants] = useState<ParticipantPresence[]>([
    { uid: agoraData.uid, name: userSession.name, role: userSession.role },
  ]);
  const participantsRef = useRef(
    new Map<string, ParticipantPresence>([
      [
        agoraData.uid,
        { uid: agoraData.uid, name: userSession.name, role: userSession.role },
      ],
    ]),
  );

  // Transcript + agent state — managed with AgoraVoiceAI (see effect below).
  const [rawTranscript, setRawTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<ClassroomAgentMetric[]>([]);
  const [connectionIssues, setConnectionIssues] = useState<ConnectionIssue[]>(
    [],
  );
  const addConnectionIssue = useCallback((issue: ConnectionIssue) => {
    setConnectionIssues((prev) => {
      const isDuplicate = prev.some(
        (x) =>
          x.agentUserId === issue.agentUserId &&
          x.code === issue.code &&
          x.message === issue.message &&
          Math.abs(x.timestamp - issue.timestamp) < 1500,
      );
      if (isDuplicate) return prev;
      return [issue, ...prev].slice(0, MAX_CONNECTION_ISSUES);
    });
  }, []);

  // Auto-open details panel as soon as a new issue is recorded.
  useEffect(() => {
    if (connectionIssues.length > 0) {
      setIsConnectionDetailsOpen(true);
    }
  }, [connectionIssues.length]);

  // StrictMode guard: delay `useJoin`'s ready flag until after the fake-unmount
  // cycle completes. React StrictMode fires cleanup synchronously before any
  // setTimeout callback, so the first (fake) mount's timeout is always cancelled.
  // Only the real second mount's timeout fires, meaning useJoin joins exactly once.
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

  const { isConnected: joinSuccess } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  // Create mic track only after the StrictMode fake-unmount cycle completes (isReady).
  // Passing `true` here creates two tracks in StrictMode — the first publishes, then
  // StrictMode cleanup closes it and the second takes over, causing a ~3s audio gap.
  // isReady uses the same setTimeout(fn,0) pattern as useJoin: StrictMode cleanup fires
  // synchronously before the timeout, so only the real second mount's timer fires.
  // Do NOT pass `isEnabled` — that ties track lifetime to mute state and breaks the Web Audio
  // graph inside MicButtonWithVisualizer. Mute uses track.setEnabled() only.
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);

  // ENABLE_AUDIO_PTS is a module-level SDK parameter (not on the client instance).
  // It must be set before publishing audio for transcript timing to be accurate.
  useEffect(() => {
    if (!client) return;
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.(
        "ENABLE_AUDIO_PTS",
        true,
      );
    } catch (error) {
      console.warn("Could not set ENABLE_AUDIO_PTS:", error);
    }
  }, [client]);

  // Track the auto-assigned RTC UID for token renewal and agent invite.
  useEffect(() => {
    if (joinSuccess && client) {
      const uid = client.uid;
      if (uid !== null && uid !== undefined) {
        setJoinedUID(uid);
      }
    }
  }, [joinSuccess, client]);

  // Initialize AgoraVoiceAI once the channel is joined.
  //
  // Gating on `isReady && joinSuccess` is critical for StrictMode safety:
  //   - `isReady` ensures we are past the initial fake-unmount cycle, so this
  //     effect only runs on the real mount (not the discarded fake one).
  //   - Once `isReady` is true, React does NOT double-invoke this effect for
  //     subsequent state changes (`joinSuccess` becoming true). That means
  //     AgoraVoiceAI.init() is called exactly once.
  useEffect(() => {
    if (!isReady || !joinSuccess) return;

    let cancelled = false;

    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: true,
        });

        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              // Tear down only the instance created by this effect run.
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => {
          setRawTranscript([...t]);

          // Broadcast completed turns via RTM so the teacher's client can
          // accumulate a full session transcript for the post-class summary.
          // Only broadcast turns we haven't sent yet (deduplicate by turn_id).
          for (const item of t) {
            if (item.status === TurnStatus.IN_PROGRESS) continue;
            if (!item.turn_id || !item.text) continue;
            if (broadcastedTurnIds.current.has(item.turn_id)) continue;
            broadcastedTurnIds.current.add(item.turn_id);

            const localUid = String(client.uid);
            const isLocalUser = item.uid === "0" || item.uid === localUid;
            const isAgent = item.uid === agentUID;

            if (!isLocalUser && !isAgent) continue; // not our turn to broadcast

            const turn: TranscriptTurn & { type: "transcript_turn" } = {
              type: "transcript_turn",
              name: isAgent ? "SonaAI" : userSession.name,
              role: isAgent ? "agent" : userSession.role,
              text: typeof item.text === "string" ? item.text : "",
              timestamp: Date.now(),
            };

            // Notify local accumulator immediately (no need to receive own RTM message).
            onTranscriptTurnRef.current?.(turn);
            ingestTurnRef.current?.(turn);

            // If summary mode is active and this is the agent's turn, capture it
            // as the post-class summary (fire once per attempt).
            // summaryModeRef is the shared ref object — read .current directly,
            // no async propagation delay.
            if (
              isAgent &&
              (summaryModeRef?.current ?? false) &&
              !summaryCaptured.current &&
              typeof item.text === "string" &&
              item.text.trim().length > 0
            ) {
              summaryCaptured.current = true;
              onSummaryTurnRef.current?.(item.text);
            }

            // Broadcast to other participants (primarily so teacher's client can
            // receive student turns it wouldn't otherwise see locally).
            rtmClient
              .publish(agoraData.channel, JSON.stringify(turn))
              .catch((err) =>
                console.warn("[transcript] RTM publish failed:", err),
              );
          }
        });
        // Agent state drives the visualizer, independent of RTC audio presence.
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) =>
          setAgentState(event.state),
        );
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => {
          setAgentMetrics((prev) => [...prev, metrics].slice(-8));
        });
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-message-error-${error.code}`,
            source: "rtm",
            agentUserId,
            code: error.code,
            message: error.message,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // SAL status: capture raw RTM messages so message.sal_status surfaces even if higher-level events don't.
        ai.on(
          AgoraVoiceAIEvents.MESSAGE_SAL_STATUS,
          (agentUserId, salStatus) => {
            if (
              salStatus.status === MessageSalStatus.VP_REGISTER_FAIL ||
              salStatus.status === MessageSalStatus.VP_REGISTER_DUPLICATE
            ) {
              addConnectionIssue({
                id: `${Date.now()}-${agentUserId}-sal-${salStatus.status}`,
                source: "rtm",
                agentUserId,
                code: salStatus.status,
                message: `SAL status: ${salStatus.status}`,
                timestamp: normalizeTimestampMs(salStatus.timestamp),
              });
            }
          },
        );
        // Agent error: capture raw RTM messages so message.error surfaces even if higher-level events don't.
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-agent-error-${error.code}`,
            source: "agent",
            agentUserId,
            code: error.code,
            message: `${error.type}: ${error.message}`,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // subscribeMessage binds the toolkit to both RTC stream messages and RTM payloads.
        ai.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.error("[AgoraVoiceAI] init failed:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  // Raw RTM parsing is kept as a fallback for signaling-level errors and SAL status.
  useEffect(() => {
    const handleRtmMessage = (event: {
      message: string | Uint8Array;
      publisher: string;
    }) => {
      const payloadText =
        typeof event.message === "string"
          ? event.message
          : new TextDecoder().decode(event.message);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        return;
      }

      if (isRtmMessageErrorPayload(parsed)) {
        const p = parsed;
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-msg-error-${p.code ?? "unknown"}`,
          source: "rtm-signaling",
          agentUserId: event.publisher,
          code: p.code ?? "unknown",
          message: `${p.module ?? "unknown"}: ${p.message ?? "Unknown signaling error"}`,
          timestamp: normalizeTimestampMs(p.send_ts ?? Date.now()),
        });
        return;
      }

      if (isRtmSalStatusPayload(parsed)) {
        const p = parsed;
        if (
          p.status === "VP_REGISTER_FAIL" ||
          p.status === "VP_REGISTER_DUPLICATE"
        ) {
          addConnectionIssue({
            id: `${Date.now()}-${event.publisher}-rtm-sal-${p.status}`,
            source: "rtm-signaling",
            agentUserId: event.publisher,
            code: p.status,
            message: `SAL status: ${p.status}`,
            timestamp: normalizeTimestampMs(p.timestamp ?? Date.now()),
          });
        }
      }

      // Receive transcript turns broadcast by other participants and accumulate them.
      // We skip turns from ourselves (already handled in TRANSCRIPT_UPDATED above).
      if (isTranscriptTurnPayload(parsed)) {
        onTranscriptTurnRef.current?.(parsed);
        // The teacher's engine needs student turns to see a pattern at all; this is the only
        // place they arrive. The engine dedupes, so an echo of our own publish is harmless.
        ingestTurnRef.current?.(parsed);
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "participant_presence"
      ) {
        const participant = (parsed as { participant?: ParticipantPresence })
          .participant;
        if (
          participant &&
          typeof participant.uid === "string" &&
          typeof participant.name === "string" &&
          (participant.role === "teacher" || participant.role === "student")
        ) {
          participantsRef.current.set(participant.uid, participant);
          setParticipants([...participantsRef.current.values()]);
        }
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "participant_presence_request"
      ) {
        rtmClient
          .publish(
            agoraData.channel,
            JSON.stringify({
              type: "participant_roster",
              participants: [...participantsRef.current.values()],
            }),
          )
          .catch(() => {});
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "participant_roster"
      ) {
        const roster = (parsed as { participants?: ParticipantPresence[] })
          .participants;
        if (Array.isArray(roster)) {
          for (const participant of roster) {
            if (participant?.uid && participant.name) {
              participantsRef.current.set(participant.uid, participant);
            }
          }
          setParticipants([...participantsRef.current.values()]);
        }
      }

      // The teacher moved the AUTO / ASK / MUTE dial. Students mirror it so everyone in the
      // room can see what SonaAI is currently permitted to do.
      if (isAiModePayload(parsed)) {
        onRemoteAiModeRef.current?.(parsed.mode);
      }

      // Receive the agent_id the teacher broadcast when the agent session started.
      // This enables the chat input on student clients (and any client that joined
      // before receiving the agent_id via the initial token/metadata path).
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "agent_session" &&
        typeof (parsed as { agent_id?: unknown }).agent_id === "string"
      ) {
        onAgentIdRef.current?.((parsed as { agent_id: string }).agent_id);
      }

      // A student is requesting the agent_id (Fix 3: request/response pattern).
      // The teacher's client responds by re-broadcasting agent_session if it has one.
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "request_agent_id"
      ) {
        onRequestAgentIdRef.current?.();
      }
    };

    rtmClient.addEventListener("message", handleRtmMessage);
    return () => {
      rtmClient.removeEventListener("message", handleRtmMessage);
    };
  }, [rtmClient, agoraData.channel, addConnectionIssue]);

  useEffect(() => {
    const announce = () => {
      const ownPresence: ParticipantPresence = {
        uid: agoraData.uid,
        name: userSession.name,
        role: userSession.role,
      };
      rtmClient
        .publish(
          agoraData.channel,
          JSON.stringify({
            type: "participant_presence",
            participant: ownPresence,
          }),
        )
        .catch(() => {});
      rtmClient
        .publish(
          agoraData.channel,
          JSON.stringify({ type: "participant_presence_request" }),
        )
        .catch(() => {});
    };
    announce();
  }, [
    agoraData.channel,
    agoraData.uid,
    rtmClient,
    userSession.name,
    userSession.role,
  ]);

  // The toolkit uses uid="0" for local user speech — remap to actual RTC UID
  // so the transcript panel renders user messages on the correct side.
  // Also normalize punctuation spacing for display when upstream text arrives compacted.
  const transcript = useMemo(() => {
    return normalizeTranscript(rawTranscript, String(client.uid));
  }, [rawTranscript, client.uid]);

  // Completed (END + INTERRUPTED) messages shown as history.
  // INTERRUPTED must be included — if the agent's first turn is cut off,
  // messageList stays empty and the first interrupted turn is never shown.
  const messageList = useMemo(() => getMessageList(transcript), [transcript]);

  const currentInProgressMessage = useMemo(() => {
    // The live partial turn renders separately from the completed history list.
    return getCurrentInProgressMessage(transcript);
  }, [transcript]);

  // Publish local mic once the track exists; usePublish waits for RTC connection.
  usePublish([localMicrophoneTrack]);

  useClientEvent(client, "user-joined", (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(true);
  });

  useClientEvent(client, "user-left", (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(false);
  });

  useClientEvent(client, "user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "audio") user.audioTrack?.play();
  });

  // Sync isAgentConnected with remoteUsers (covers cases where user-joined/left are missed)
  useEffect(() => {
    const isAgentInRemoteUsers = remoteUsers.some(
      (user) => user.uid.toString() === agentUID,
    );
    setIsAgentConnected(isAgentInRemoteUsers);
  }, [remoteUsers, agentUID]);

  useClientEvent(client, "connection-state-change", (curState) => {
    setConnectionState(curState);
  });

  const connectionSeverity = useMemo<"normal" | "warning" | "error">(() => {
    // RTC transport problems take precedence; otherwise derive severity from captured issues.
    if (
      connectionState === "DISCONNECTED" ||
      connectionState === "DISCONNECTING"
    ) {
      return "error";
    }
    if (
      connectionState === "CONNECTING" ||
      connectionState === "RECONNECTING"
    ) {
      return "warning";
    }
    if (connectionIssues.length === 0) {
      return "normal";
    }
    return connectionIssues.some(
      (issue) => getConversationIssueSeverity(issue) === "error",
    )
      ? "error"
      : "warning";
  }, [connectionState, connectionIssues]);

  const visualizerState = useMemo(
    () =>
      mapAgentVisualizerState(agentState, isAgentConnected, connectionState),
    [agentState, isAgentConnected, connectionState],
  );

  /**
   * Mute/unmute via track.setEnabled() only — usePublish owns publish state.
   * If we also unpublish in the toggle, usePublish and the button fight each other
   * and break the MicButtonWithVisualizer Web Audio graph.
   */
  const handleMicToggle = useCallback(async () => {
    const next = !isEnabled;
    const track = localMicrophoneTrack;
    if (!track) {
      setIsEnabled(next);
      return;
    }
    try {
      await track.setEnabled(next);
      setIsEnabled(next);
    } catch (error) {
      console.error("Failed to toggle microphone:", error);
    }
  }, [isEnabled, localMicrophoneTrack]);

  // ─── Intervention Engine ───────────────────────────────────────────────────
  //
  // Runs on the teacher's client only. The engine decides *whether* SonaAI contributes; the
  // agent's own model only decides the wording. Keeping those two apart is what makes the
  // teacher's control real rather than a polite request inside a prompt.
  const isTeacher = userSession.role === "teacher";

  /**
   * Deliver an approved intervention to the live agent.
   *
   * Sent over RTM with `ai.sendText` rather than the REST `/think` endpoint: the REST path
   * needs the Customer ID/Secret pair for HTTP Basic auth and returns 401 from the browser.
   * `responseInterruptable: true` so a student or the teacher can talk over SonaAI at any point.
   */
  const handleEngineSpeak = useCallback(
    async (instruction: string, decision: InterventionDecision) => {
      if (!agoraData.agentId) {
        console.warn("[sona] no agent session — cannot deliver intervention");
        return;
      }
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (!ai) throw new Error("AI not initialized");
        await ai.sendText(agoraData.agentId, {
          messageType: ChatMessageType.TEXT,
          text: instruction,
          priority: ChatMessagePriority.INTERRUPTED,
          responseInterruptable: true,
        });
      } catch (err) {
        console.error(
          "[sona] failed to deliver intervention:",
          err,
          decision.id,
        );
      }
    },
    [agoraData.agentId],
  );

  const engine = useInterventionEngine({
    sessionId: agoraData.channel,
    aiMode,
    enabled: isTeacher && joinSuccess,
    // Only meaningful for the teacher: on a student's client this is the student's own mic.
    localMicrophoneTrack: isTeacher ? localMicrophoneTrack : null,
    onSpeak: handleEngineSpeak,
  });

  const teacherPresence = participants.find(
    (participant) => participant.role === "teacher",
  );

  useEffect(() => {
    ingestTurnRef.current = isTeacher ? engine.ingestTurn : null;
  }, [isTeacher, engine.ingestTurn]);

  const handleTokenWillExpire = useCallback(async () => {
    if (!onTokenWillExpire || !joinedUID) return;
    try {
      // RTC and RTM renew independently, but the quickstart fetches both in one request.
      const { rtcToken, rtmToken } = await onTokenWillExpire(
        joinedUID.toString(),
      );
      await client?.renewToken(rtcToken);
      await rtmClient.renewToken(rtmToken);
    } catch (error) {
      console.error("Failed to renew Agora token:", error);
    }
  }, [client, onTokenWillExpire, joinedUID, rtmClient]);

  useClientEvent(client, "token-privilege-will-expire", handleTokenWillExpire);

  const handleEndConversation = useCallback(async () => {
    onEndConversation();
  }, [onEndConversation]);

  // Text-chat fallback: lets any participant type a message to the AI.
  // The message is prefixed with speaker identity before injection so the AI
  // sees the same [Role: Name]: format as voice turns.
  const [chatText, setChatText] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const handleSendChat = useCallback(async () => {
    const trimmed = chatText.trim();
    if (!trimmed || isChatSending) return;

    const roleLabel = userSession.role === "teacher" ? "Teacher" : "Student";
    const prefixed = `[${roleLabel}: ${userSession.name}]: ${trimmed}`;

    setIsChatSending(true);
    setChatText("");

    // Broadcast as a transcript_turn so it appears in the teacher's log
    // identically to a spoken turn (same format used in TRANSCRIPT_UPDATED).
    const turn: TranscriptTurn & { type: "transcript_turn" } = {
      type: "transcript_turn",
      name: userSession.name,
      role: userSession.role,
      text: trimmed,
      timestamp: Date.now(),
    };
    onTranscriptTurnRef.current?.(turn);
    ingestTurnRef.current?.(turn);
    rtmClient
      .publish(agoraData.channel, JSON.stringify(turn))
      .catch((err) => console.warn("[chat] RTM broadcast failed:", err));

    // Student messages must enter the teacher's intervention engine instead of
    // bypassing approval through Agora's direct text-injection path.
    if (userSession.role === "student") {
      setIsChatSending(false);
      return;
    }

    if (!agoraData.agentId) {
      setIsChatSending(false);
      return;
    }

    try {
      const ai = AgoraVoiceAI.getInstance();
      if (!ai) throw new Error("AI not initialized");

      // Send the text message directly over RTM, avoiding the REST API 401 error
      await ai.sendText(agoraData.agentId, {
        messageType: ChatMessageType.TEXT,
        text: prefixed,
        priority: ChatMessagePriority.INTERRUPTED,
        responseInterruptable: true,
      });
    } catch (err) {
      console.error("Failed to send chat message:", err);
    } finally {
      setIsChatSending(false);
    }
  }, [chatText, isChatSending, agoraData, userSession, rtmClient]);

  return (
    <ClassroomConversationLayout
      statusPanel={
        <ConnectionStatusPanel
          connectionState={connectionState}
          connectionSeverity={connectionSeverity}
          connectionIssues={connectionIssues}
          isOpen={isConnectionDetailsOpen}
          onToggle={() => setIsConnectionDetailsOpen((open) => !open)}
        />
      }
      pipelineMetrics={<ClassroomPipelineMetrics metrics={agentMetrics} />}
      transcriptPanel={
        <ClassroomTranscriptPanel
          messageList={messageList}
          currentInProgressMessage={currentInProgressMessage}
          agentUID={agentUID}
        />
      }
      visualizer={
        <div
          className="relative flex h-full min-h-[20rem] w-full max-w-4xl items-center justify-center"
          role="region"
          aria-label="AI agent status visualization"
        >
          <SonaAIExpression state={visualizerState} size="lg" />
        </div>
      }
      controls={
        <div className="conversation-mic-host flex items-center justify-center">
          <button
            type="button"
            onClick={handleMicToggle}
            aria-label={isEnabled ? "Mute microphone" : "Unmute microphone"}
            className={`flex h-12 w-12 items-center justify-center rounded-full text-xl shadow-lg transition-colors ${
              isEnabled
                ? "bg-primary text-primary-foreground"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            {isEnabled ? (
              <Mic className="h-5 w-5" />
            ) : (
              <MicOff className="h-5 w-5" />
            )}
          </button>
        </div>
      }
      micSelector={
        <MicrophoneSelector localMicrophoneTrack={localMicrophoneTrack} />
      }
      aiModeControl={teacherControls}
      participants={participants}
      teacherName={
        teacherPresence?.name ?? (isTeacher ? userSession.name : "Teacher")
      }
      onCopyInviteLink={async () => {
        const inviteUrl = `${window.location.origin}/meeting?join=${encodeURIComponent(agoraData.channel)}`;
        try {
          await navigator.clipboard.writeText(inviteUrl);
          setInviteCopied(true);
          window.setTimeout(() => setInviteCopied(false), 2200);
        } catch {
          const copied = window.prompt(
            "Copy this class invite link:",
            inviteUrl,
          );
          if (copied !== null) {
            setInviteCopied(true);
            window.setTimeout(() => setInviteCopied(false), 2200);
          }
        }
      }}
      inviteCopied={inviteCopied}
      aiStateBadge={
        isTeacher ? (
          <ClassroomAiStateBadge
            state={engine.aiState}
            reason={engine.lastDecision?.reason}
          />
        ) : undefined
      }
      interventionCard={
        isTeacher && engine.pendingIntervention ? (
          <ClassroomInterventionCard
            decision={engine.pendingIntervention}
            quotes={engine.pendingQuotes}
            onAllow={engine.allow}
            onDeny={engine.deny}
          />
        ) : undefined
      }
      signalPanel={
        isTeacher ? (
          <ClassroomSignalPanel
            aiMode={aiMode}
            aiState={engine.aiState}
            lastDecision={engine.lastDecision}
            signals={engine.signals}
            history={engine.history}
            lessonConcepts={engine.lessonConcepts}
            teacherIsSpeaking={engine.teacherIsSpeaking}
          />
        ) : undefined
      }
      sessionTitle={`Class ${userSession.classroomCode}`}
      participantCount={remoteUsers.length + 1}
      chatInput={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendChat();
          }}
          className="flex w-full items-center gap-2 mt-2"
          aria-label="Type a message to the AI"
        >
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Ask anything about the meeting..."
            disabled={
              isChatSending ||
              (summaryModeRef?.current ?? false) ||
              (userSession.role === "teacher" && !agoraData.agentId)
            }
            maxLength={500}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 disabled:opacity-50 shadow-sm"
            aria-label="Chat message input"
          />
          <button
            type="submit"
            disabled={
              !chatText.trim() ||
              isChatSending ||
              (summaryModeRef?.current ?? false) ||
              (userSession.role === "teacher" && !agoraData.agentId)
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-none bg-[#D0FFA2] text-[#031A10] transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 shadow-sm"
            aria-label="Send message"
          >
            {isChatSending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <SendHorizontal className="h-5 w-5" />
            )}
          </button>
        </form>
      }
      onEndConversation={handleEndConversation}
    />
  );
}
