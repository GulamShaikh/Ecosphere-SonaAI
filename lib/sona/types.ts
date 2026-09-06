/**
 * SonaAI — Intervention Engine contract types.
 *
 * Ported from the original SonaAI backend (`backend/src/sona`, `packages/shared`) into
 * this Next.js app. The engine now runs client-side on the TEACHER's browser, which is
 * the only client that sees every participant's attributed transcript turn over RTM.
 *
 * The terminology below is fixed by SRS §9.2, §9.3 and §26 — SPEAK / WAIT / ASK / MUTE
 * and AUTO / ASK / MUTE. Do not rename these values.
 */

/** What the teacher has permitted. Set by the teacher, enforced by the engine. */
export type AiMode = 'AUTO' | 'ASK' | 'MUTE';

/** What SonaAI is currently doing. Derived from a decision, never set directly. */
export type AiState =
  | 'LISTENING'
  | 'UNDERSTANDING'
  | 'WAITING'
  | 'ASKING'
  | 'SPEAKING'
  | 'MUTED';

/** Output of the Intervention Engine. */
export type InterventionAction = 'SPEAK' | 'WAIT' | 'ASK' | 'MUTE';

export type SpeakerRole = 'teacher' | 'student' | 'agent';

export interface LessonContext {
  /** Human-readable current topic, e.g. "Newton's Second Law". */
  topic: string;
  /** Coarse phase of the lesson. */
  stage: 'intro' | 'explanation' | 'discussion' | 'practice' | 'wrap_up';
  /** Concepts mentioned recently, most recent first. */
  recentConcepts: string[];
  updatedAt: string;
}

export interface ConversationEvent {
  id: string;
  sessionId: string;
  /** Display name doubles as the speaker id — RTM turns carry names, not user ids. */
  speakerId: string;
  speakerRole: SpeakerRole;
  speakerName: string;
  /** Transcribed utterance. */
  text: string;
  type: 'utterance' | 'question' | 'answer' | 'system';
  timestamp: string;
}

export type SignalType =
  | 'REPEATED_CONFUSION'
  | 'UNANSWERED_QUESTION'
  | 'DIRECT_REQUEST';

export interface LearningSignal {
  id: string;
  sessionId: string;
  type: SignalType;
  /** The concept students are struggling with, e.g. "acceleration". */
  concept: string;
  /** Display names of students showing the signal. */
  affectedStudents: string[];
  /** 0–1. Policy thresholds live in interventionEngine.ts. */
  confidence: number;
  /** Event ids that produced this signal, so the teacher can see the actual quotes. */
  evidence: string[];
  timestamp: string;
}

export interface InterventionDecision {
  id: string;
  sessionId: string;
  action: InterventionAction;
  /** Short, teacher-readable justification. Shown verbatim in the UI. */
  reason: string;
  /** The signal that prompted this, if any. */
  signalId: string | null;
  concept: string | null;
  confidence: number;
  /** Set once the teacher responds to an ASK. */
  teacherResponse: 'ALLOW' | 'DENY' | null;
  /** What SonaAI was asked to say, once it spoke. */
  spokenText: string | null;
  timestamp: string;
}

/**
 * The classroom state the engine reasons over.
 *
 * Trimmed relative to the original backend `ClassroomState`: the browser has no store,
 * no quiz records and no participant registry, so `participants` is replaced by the
 * single boolean the policy actually reads — whether the teacher is mid-utterance.
 */
export interface SonaClassroomState {
  /** The Agora channel name doubles as the session id. */
  sessionId: string;
  lessonContext: LessonContext;
  /** Rolling window, oldest first. Capped at EVENT_WINDOW. */
  recentEvents: ConversationEvent[];
  learningSignals: LearningSignal[];
  aiMode: AiMode;
  aiState: AiState;
  /** Non-null when SonaAI is waiting on a teacher decision. */
  pendingIntervention: InterventionDecision | null;
  interventionHistory: InterventionDecision[];
  /** Live from the RTC volume indicator — true while the teacher's voice is active. */
  teacherIsSpeaking: boolean;
  updatedAt: string;
}

/**
 * Browser-safe id generator.
 *
 * `crypto.randomUUID` is unavailable on insecure non-localhost origins, so fall back
 * rather than throw mid-class. Ids are local correlation keys only — never security
 * tokens — so a weaker fallback is acceptable here.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
