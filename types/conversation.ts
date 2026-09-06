import type { RTMClient } from 'agora-rtm';
import type { ReactNode, MutableRefObject } from 'react';

/** Lightweight session identity — no auth, just name + role + classroom. */
export type UserRole = 'teacher' | 'student';

export interface UserSession {
  name: string;
  role: UserRole;
  classroomCode: string;
}

export interface AgoraTokenData {
  token: string;
  uid: string;
  channel: string;
  agentId?: string;
}

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
  /** Display name of the user joining the session. */
  user_name: string;
  /** Role of the user: 'teacher' or 'student'. */
  user_role: UserRole;
}

export interface StopConversationRequest {
  agent_id: string;
}

export interface AgentResponse {
  agent_id: string;
  create_ts: number;
  state: string;
}

export interface AgoraRenewalTokens {
  rtcToken: string;
  rtmToken: string;
}

/** A single attributed turn in the session log — used for the post-class summary. */
export interface TranscriptTurn {
  name: string;
  role: 'teacher' | 'student' | 'agent';
  text: string;
  timestamp: number;
}

export interface ParticipantPresence {
  uid: string;
  name: string;
  role: UserRole;
}

export interface ConversationComponentProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  userSession: UserSession;
  /** Optional slot for teacher-only controls rendered in the controls dock. */
  teacherControls?: ReactNode;
  /**
   * The teacher's current permission level for SonaAI. Owned by the parent because leaving
   * MUTE has to restart the managed agent session, which is the parent's job.
   *
   * Students receive the mode over RTM so their UI shows the same thing the teacher set.
   */
  aiMode?: import('@/lib/sona/types').AiMode;
  /**
   * Called when a mode arrives over RTM from the teacher. Student clients only — the
   * teacher's own changes go through the control in `teacherControls`.
   */
  onRemoteAiMode?: (mode: import('@/lib/sona/types').AiMode) => void;
  /**
   * Called whenever a turn completes (local user or agent) so the parent can
   * accumulate the session transcript log for the post-class summary.
   */
  onTranscriptTurn?: (turn: TranscriptTurn) => void;
  /**
   * Called when the AGENT produces a completed turn while summary mode is active.
   * The parent uses this text to generate the PDF.
   */
  onSummaryTurn?: (text: string) => void;
  /**
   * A shared mutable ref (created in the parent with useRef(false)) that signals
   * whether the next completed agent turn should be captured as the summary.
   *
   * Using a ref object instead of a boolean prop eliminates the async state→prop
   * propagation race where the agent could respond before summaryMode updates:
   * the parent sets summaryModeRef.current = true synchronously before calling
   * /api/inject-think, so ConversationComponent sees the change immediately on
   * the same event loop tick — no useEffect delay.
   */
  summaryModeRef?: MutableRefObject<boolean>;
  /**
   * Called when an agent_session RTM message is received from another participant.
   * Used by student clients to obtain the agent_id the teacher broadcast on join.
   */
  onAgentId?: (agentId: string) => void;
  /**
   * Called when a { type: 'request_agent_id' } RTM message is received from a
   * student. The teacher's client should respond by re-publishing agent_session
   * if it has an active agentId.
   */
  onRequestAgentId?: () => void;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
  onEndConversation: () => void;
}
