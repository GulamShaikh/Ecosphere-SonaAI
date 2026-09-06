/**
 * SonaAI — Intervention Engine
 *
 * This is the product. Everything else is plumbing.
 *
 * Given the current classroom state and any detected learning signal, decide whether SonaAI
 * should SPEAK, WAIT, ASK, or stay MUTE — and produce a short reason a teacher can read and
 * immediately understand.
 *
 * Rules are evaluated in order and the first match wins. Keep it that way: an ordered,
 * readable policy is worth more here than a clever scoring function nobody can debug at 2am
 * before a demo.
 *
 * Ported verbatim in behaviour from `backend/src/sona/interventionEngine.ts`. The only change
 * is where "is the teacher speaking" comes from: the backend read a participant tile, the
 * client reads the RTC volume indicator, so state carries a `teacherIsSpeaking` boolean.
 */

import {
  newId,
  type AiState,
  type InterventionAction,
  type InterventionDecision,
  type SonaClassroomState,
  type LearningSignal,
} from './types';

export interface PolicyConfig {
  /** Minimum signal confidence before SonaAI will consider speaking at all. */
  minConfidence: number;
  /** In AUTO mode, confidence required to speak without asking. */
  autoSpeakConfidence: number;
  /** Minimum gap between two interventions, in ms. Prevents pestering. */
  cooldownMs: number;
  /** How long after the teacher's last utterance we still count them as "explaining". */
  teacherSpeakingGraceMs: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  minConfidence: 0.6,
  autoSpeakConfidence: 0.75,
  cooldownMs: 45_000,
  teacherSpeakingGraceMs: 4_000,
};

export interface DecisionInput {
  state: SonaClassroomState;
  /** The strongest signal currently detected, if any. */
  signal: LearningSignal | null;
  /** True when the incoming utterance addresses SonaAI by name. */
  directlyAddressed: boolean;
  now?: number;
}

/**
 * Decide what SonaAI should do right now.
 *
 * Pure function. No I/O, no side effects, no LLM call. That makes the whole policy
 * unit-testable without Agora, without keys, without a network — see interventionEngine.test.ts.
 */
export function decide(
  input: DecisionInput,
  policy: PolicyConfig = DEFAULT_POLICY,
): InterventionDecision {
  const { state, signal, directlyAddressed } = input;
  const now = input.now ?? Date.now();

  const build = (
    action: InterventionAction,
    reason: string,
    confidence = signal?.confidence ?? 0,
  ): InterventionDecision => ({
    id: newId(),
    sessionId: state.sessionId,
    action,
    reason,
    signalId: signal?.id ?? null,
    concept: signal?.concept ?? null,
    confidence,
    teacherResponse: null,
    spokenText: null,
    timestamp: new Date(now).toISOString(),
  });

  // ── Rule 1: the teacher has muted SonaAI. Nothing else matters. ────────────
  // Checked first and unconditionally. This is one of several enforcement layers — do not
  // "simplify" it away.
  if (state.aiMode === 'MUTE') {
    return build('MUTE', 'Teacher has muted SonaAI', 0);
  }

  // ── Rule 2: someone asked SonaAI directly. ────────────────────────────────
  // ASK still requires teacher approval, even for a direct student request.
  if (directlyAddressed) {
    if (state.aiMode === 'ASK') {
      return build('ASK', 'A student asked SonaAI directly — may I answer?');
    }
    return build('SPEAK', 'A participant asked SonaAI directly', 0.95);
  }

  // Everything below needs a signal to act on.
  if (!signal) {
    return build('WAIT', 'Following the lesson', 0);
  }

  // ── Rule 3: the teacher is mid-explanation. ───────────────────────────────
  // The single most important rule in the product. A correct intervention at the wrong moment
  // is still a bad intervention.
  if (isTeacherSpeaking(state, now, policy.teacherSpeakingGraceMs)) {
    return build('WAIT', 'Teacher is explaining — holding this for a natural pause');
  }

  // ── Rule 4: this concept was already declined. Do not nag. ────────────────
  if (wasConceptDeclined(state, signal.concept)) {
    return build('WAIT', `Teacher already declined help on "${signal.concept}"`);
  }

  // ── Rule 5: cooldown since the last time SonaAI spoke. ────────────────────
  const sinceLast = msSinceLastIntervention(state, now);
  if (sinceLast !== null && sinceLast < policy.cooldownMs) {
    const secs = Math.ceil((policy.cooldownMs - sinceLast) / 1000);
    return build('WAIT', `Recently intervened — waiting ${secs}s before offering again`);
  }

  // ── Rule 6: not confident enough to be worth anyone's attention. ──────────
  if (signal.confidence < policy.minConfidence) {
    return build('WAIT', 'Signal is too weak to act on yet');
  }

  const students = signal.affectedStudents.length;
  const who = students > 1 ? `${students} students` : '1 student';

  // ── Rule 7: ASK mode — the teacher wants to approve every intervention. ───
  if (state.aiMode === 'ASK') {
    return build('ASK', `${who} appear stuck on "${signal.concept}" — may I explain?`);
  }

  // ── Rule 8: AUTO mode with high confidence. ───────────────────────────────
  if (state.aiMode === 'AUTO' && signal.confidence >= policy.autoSpeakConfidence) {
    return build('SPEAK', `${who} stuck on "${signal.concept}" — explaining briefly`);
  }

  // AUTO but below the speak bar: ask rather than guess.
  return build('ASK', `${who} may be stuck on "${signal.concept}" — may I explain?`);
}

/** Map a decision onto the AI state the UI should display. */
export function aiStateFor(decision: InterventionDecision): AiState {
  switch (decision.action) {
    case 'MUTE':
      return 'MUTED';
    case 'SPEAK':
      return 'SPEAKING';
    case 'ASK':
      return 'ASKING';
    case 'WAIT':
      if (decision.reason === 'Following the lesson') return 'LISTENING';
      return 'WAITING';
    default:
      return 'WAITING';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTeacherSpeaking(
  state: SonaClassroomState,
  now: number,
  graceMs: number,
): boolean {
  // Live signal from Agora's volume indicator.
  if (state.teacherIsSpeaking) return true;

  // Grace window: the teacher pausing for breath is not an opening.
  const lastTeacherEvent = [...state.recentEvents]
    .reverse()
    .find((e) => e.speakerRole === 'teacher');
  if (!lastTeacherEvent) return false;

  const elapsed = now - new Date(lastTeacherEvent.timestamp).getTime();
  return elapsed < graceMs;
}

function wasConceptDeclined(state: SonaClassroomState, concept: string): boolean {
  return state.interventionHistory.some(
    (d) => d.teacherResponse === 'DENY' && d.concept === concept,
  );
}

function msSinceLastIntervention(
  state: SonaClassroomState,
  now: number,
): number | null {
  const spoken = [...state.interventionHistory]
    .reverse()
    .find((d) => d.action === 'SPEAK' || d.teacherResponse === 'ALLOW');
  if (!spoken) return null;
  return now - new Date(spoken.timestamp).getTime();
}
