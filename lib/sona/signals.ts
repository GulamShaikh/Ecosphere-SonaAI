/**
 * SonaAI — Learning signal detection.
 *
 * A signal is *evidence*, not a guess. Every signal carries the event ids that produced it,
 * so the teacher's intervention card can show the actual student quotes. That transparency
 * is what makes teachers trust the thing.
 *
 * Detectors are heuristic on purpose: fast, deterministic, testable, and they work with no
 * extra API key during a demo.
 *
 * Ported from `backend/src/sona/signals.ts`. Differences from the original, both deliberate:
 *  - `node:crypto` → browser-safe `newId()`, and the agent role is `'agent'` not `'ai'`.
 *  - The confusion threshold is now enforced. The original's comment promised "two or more
 *    distinct students" but its code tested `< 1`, so a single utterance from a single
 *    student fired the signal. See MIN_CONFUSED_STUDENTS below.
 */

import {
  newId,
  type ConversationEvent,
  type LearningSignal,
  type SonaClassroomState,
} from './types';

/** Window we consider "the same moment in the lesson". */
export const SIGNAL_WINDOW_MS = 90_000;

/**
 * Distinct students needed to call it a pattern.
 *
 * One confused student is a question for the teacher, not a reason for AI to step in. Two is
 * a pattern. This is the golden-demo threshold (SRS §21) and the reason SonaAI does not
 * chirp at the first "huh?".
 */
export const MIN_CONFUSED_STUDENTS = 2;

/**
 * ...or the same student saying it again.
 *
 * The signal is REPEATED_CONFUSION, and confusion repeated in *time* is as real as confusion
 * repeated across *people* — a student who says "I still don't get it" a second time has not
 * been reached. Confidence scales with both counts, so this path scores lower than a
 * multi-student pattern rather than being treated as equivalent.
 */
export const MIN_CONFUSION_UTTERANCES = 2;

const CONFUSION_MARKERS = [
  "i don't get", 'i dont get', "don't understand", 'dont understand',
  'confused', 'confusing', 'lost', 'not clear', 'unclear',
  'what do you mean', 'can you repeat', 'say that again', 'huh',
  'why does', 'why is', 'how come', 'i thought', 'doubt',
  'samajh nahi', 'samjha nahi', // Hindi code-switching, common in our target classrooms
];

const QUESTION_MARKERS = ['?', 'what ', 'why ', 'how ', 'when ', 'which ', 'can you', 'could you'];

const SONA_NAMES = ['sona', 'sonaai', 'sona ai'];

/** Give a student a grace period to be answered before SonaAI counts it as dropped. */
const UNANSWERED_AFTER_MS = 20_000;

export interface DetectOptions {
  /** Injectable clock, so the time-based detectors are testable. */
  now?: number;
}

/**
 * Run all detectors and return the strongest signal, or null.
 *
 * A direct request always outranks a passive confusion pattern, which is what the confidence
 * ordering below encodes.
 */
export function detectSignal(
  state: SonaClassroomState,
  options: DetectOptions = {},
): LearningSignal | null {
  const now = options.now ?? Date.now();
  const recent = eventsWithin(state.recentEvents, SIGNAL_WINDOW_MS, now);

  const candidates = [
    detectDirectRequest(state, recent, now),
    detectRepeatedConfusion(state, recent, now),
    detectUnansweredQuestion(state, recent, now),
  ].filter((s): s is LearningSignal => s !== null);

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => b.confidence - a.confidence)[0];
}

/** True when the most recent utterance addresses SonaAI by name. */
export function isDirectlyAddressed(state: SonaClassroomState): boolean {
  const last = state.recentEvents[state.recentEvents.length - 1];
  if (!last || last.speakerRole === 'agent') return false;
  const text = last.text.toLowerCase();
  return SONA_NAMES.some((n) => text.includes(n));
}

// ─── Detectors ───────────────────────────────────────────────────────────────

/**
 * REPEATED_CONFUSION — confusion about the same concept repeats inside the window, either
 * across students or from one student more than once.
 *
 * This is the golden-demo signal, and it is deliberately conservative.
 */
function detectRepeatedConfusion(
  state: SonaClassroomState,
  recent: ConversationEvent[],
  now: number,
): LearningSignal | null {
  const confused = recent.filter(
    (e) => e.speakerRole === 'student' && looksConfused(e.text),
  );
  if (confused.length === 0) return null;

  const students = [...new Set(confused.map((e) => e.speakerId))];

  const isPattern =
    students.length >= MIN_CONFUSED_STUDENTS ||
    confused.length >= MIN_CONFUSION_UTTERANCES;
  if (!isPattern) return null;

  const concept = inferConcept(confused, state);

  // More students and more utterances mean higher confidence, capped so nothing is ever
  // presented as certain. SonaAI should never sound more sure than it is.
  const confidence = Math.min(
    0.95,
    0.55 + students.length * 0.12 + confused.length * 0.04,
  );

  return {
    id: newId(),
    sessionId: state.sessionId,
    type: 'REPEATED_CONFUSION',
    concept,
    affectedStudents: students,
    confidence: round2(confidence),
    evidence: confused.map((e) => e.id),
    timestamp: new Date(now).toISOString(),
  };
}

/**
 * UNANSWERED_QUESTION — a student asked something and nobody replied.
 *
 * Lower confidence than repeated confusion: the teacher may simply be about to answer.
 */
function detectUnansweredQuestion(
  state: SonaClassroomState,
  recent: ConversationEvent[],
  now: number,
): LearningSignal | null {
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.speakerRole !== 'student' || !looksLikeQuestion(e.text)) continue;

    const asked = new Date(e.timestamp).getTime();
    if (now - asked < UNANSWERED_AFTER_MS) return null; // still fresh, give the teacher a chance

    const answered = recent
      .slice(i + 1)
      .some((later) => later.speakerRole === 'teacher' || later.speakerRole === 'agent');
    if (answered) return null;

    return {
      id: newId(),
      sessionId: state.sessionId,
      type: 'UNANSWERED_QUESTION',
      concept: inferConcept([e], state),
      affectedStudents: [e.speakerId],
      confidence: 0.65,
      evidence: [e.id],
      timestamp: new Date(now).toISOString(),
    };
  }
  return null;
}

/** DIRECT_REQUEST — someone said SonaAI's name. Highest confidence by definition. */
function detectDirectRequest(
  state: SonaClassroomState,
  recent: ConversationEvent[],
  now: number,
): LearningSignal | null {
  const last = recent[recent.length - 1];
  if (!last || last.speakerRole === 'agent') return null;
  if (!SONA_NAMES.some((n) => last.text.toLowerCase().includes(n))) return null;

  return {
    id: newId(),
    sessionId: state.sessionId,
    type: 'DIRECT_REQUEST',
    concept: inferConcept([last], state),
    affectedStudents: last.speakerRole === 'student' ? [last.speakerId] : [],
    confidence: 0.95,
    evidence: [last.id],
    timestamp: new Date(now).toISOString(),
  };
}

// ─── Concept inference ───────────────────────────────────────────────────────

/**
 * Work out what the confusion is *about*.
 *
 * Prefer a concept the lesson context already knows about and that the students actually
 * mentioned; otherwise fall back to the current topic. Never invent a concept that appears
 * nowhere — a wrong concept on the teacher's card destroys trust faster than no card at all.
 */
function inferConcept(
  events: ConversationEvent[],
  state: SonaClassroomState,
): string {
  // Newest utterance first. What a student just said is a better guide to what they are stuck
  // on than something they said a minute ago — and in a lesson that has touched several
  // concepts, scanning flattened text returns whichever concept the teacher mentioned most
  // recently rather than the one the students are actually asking about.
  for (let i = events.length - 1; i >= 0; i--) {
    const text = events[i].text.toLowerCase();
    const mentioned = state.lessonContext.recentConcepts.find((c) =>
      text.includes(c.toLowerCase()),
    );
    if (mentioned) return mentioned;
  }

  return state.lessonContext.topic || 'the current topic';
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function looksConfused(text: string): boolean {
  const t = text.toLowerCase();
  return CONFUSION_MARKERS.some((m) => t.includes(m));
}

function looksLikeQuestion(text: string): boolean {
  const t = text.toLowerCase().trim();
  return QUESTION_MARKERS.some((m) => t.includes(m));
}

function eventsWithin(
  events: ConversationEvent[],
  windowMs: number,
  now: number,
): ConversationEvent[] {
  const cutoff = now - windowMs;
  return events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
