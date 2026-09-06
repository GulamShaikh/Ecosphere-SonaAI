/**
 * SonaAI — classroom context model.
 *
 * Maintains what SonaAI knows about the lesson right now: topic, stage, recent concepts,
 * and a rolling window of what was said. Deliberately small — long-term learner memory is
 * out of scope here.
 *
 * Ported from the SonaAI backend (`backend/src/sona/context.ts`). Two changes for the
 * browser: `node:crypto` is replaced by the browser-safe `newId()`, and `currentSpeaker`
 * is dropped because nothing on the client reads it.
 *
 * These functions mutate the state object in place, as the original did. The hook that owns
 * the state keeps it in a ref and publishes immutable snapshots to React, so mutation never
 * escapes into render.
 */

import {
  newId,
  type ConversationEvent,
  type LessonContext,
  type SonaClassroomState,
  type SpeakerRole,
} from './types';

/** How many events we keep in memory per session. Enough for context, small enough to send. */
export const EVENT_WINDOW = 40;

export function emptyLessonContext(topic: string): LessonContext {
  return {
    topic,
    stage: 'intro',
    recentConcepts: [],
    updatedAt: new Date().toISOString(),
  };
}

/** A fresh classroom state for a channel. `topic` seeds concept inference. */
export function emptyClassroomState(
  sessionId: string,
  topic: string,
): SonaClassroomState {
  return {
    sessionId,
    lessonContext: emptyLessonContext(topic),
    recentEvents: [],
    learningSignals: [],
    aiMode: 'ASK',
    aiState: 'LISTENING',
    pendingIntervention: null,
    interventionHistory: [],
    teacherIsSpeaking: false,
    updatedAt: new Date().toISOString(),
  };
}

export interface RecordEventInput {
  sessionId: string;
  speakerId: string;
  speakerRole: SpeakerRole;
  speakerName: string;
  text: string;
  /** RTM turns carry their own timestamp; prefer it over arrival time. */
  timestamp?: string;
}

/** Append an utterance to the state and update derived context. Mutates and returns the event. */
export function recordEvent(
  state: SonaClassroomState,
  input: RecordEventInput,
): ConversationEvent {
  const event: ConversationEvent = {
    id: newId(),
    sessionId: input.sessionId,
    speakerId: input.speakerId,
    speakerRole: input.speakerRole,
    speakerName: input.speakerName,
    text: input.text.trim(),
    type: classify(input.text, input.speakerRole),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  state.recentEvents.push(event);
  if (state.recentEvents.length > EVENT_WINDOW) {
    state.recentEvents.splice(0, state.recentEvents.length - EVENT_WINDOW);
  }

  updateLessonContext(state, event);
  state.updatedAt = new Date().toISOString();

  return event;
}

/**
 * Update topic/stage/concepts from what was just said.
 *
 * Heuristic and cheap: it runs on every utterance, so it cannot afford an LLM round trip.
 * Concepts come from the teacher's speech only — students repeating a wrong term should not
 * become the lesson's vocabulary.
 */
function updateLessonContext(
  state: SonaClassroomState,
  event: ConversationEvent,
): void {
  const ctx = state.lessonContext;

  if (event.speakerRole === 'teacher') {
    for (const concept of extractConcepts(event.text)) {
      const existing = ctx.recentConcepts.filter(
        (c) => c.toLowerCase() !== concept.toLowerCase(),
      );
      ctx.recentConcepts = [concept, ...existing].slice(0, 8);
    }
    if (ctx.stage === 'intro' && state.recentEvents.length > 4) {
      ctx.stage = 'explanation';
    }
  }

  if (event.speakerRole === 'student' && ctx.stage === 'explanation') {
    const studentTurns = state.recentEvents.filter(
      (e) => e.speakerRole === 'student',
    ).length;
    if (studentTurns >= 3) ctx.stage = 'discussion';
  }

  ctx.updatedAt = new Date().toISOString();
}

/**
 * Pull candidate concept phrases out of an utterance.
 *
 * Capitalised multi-word phrases ("Newton's Second Law") plus a small physics/maths lexicon
 * covering the golden demo. Extend the lexicon per subject.
 */
const LEXICON = [
  'acceleration', 'velocity', 'momentum', 'inertia', 'friction', 'gravity',
  'mass', 'force', 'newton', 'displacement', 'kinetic energy', 'potential energy',
  'derivative', 'integral', 'function', 'equation', 'variable', 'coefficient',
];

export function extractConcepts(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const term of LEXICON) {
    if (lower.includes(term)) found.add(term);
  }

  // "Newton's Second Law", "Law of Motion" — two or more capitalised words in a row.
  const proper = text.match(
    /\b([A-Z][a-z']+(?:\s+(?:of|the)\s+)?(?:\s+[A-Z][a-z']+)+)\b/g,
  );
  for (const m of proper ?? []) found.add(m);

  return [...found];
}

function classify(text: string, role: SpeakerRole): ConversationEvent['type'] {
  if (role === 'agent') return 'utterance';
  const t = text.trim();
  if (t.includes('?')) return 'question';
  if (role === 'student' && /^(yes|no|it|the|because|halves?|doubles?)/i.test(t)) {
    return 'answer';
  }
  return 'utterance';
}

/** Compact the recent transcript for a prompt. */
export function transcriptFor(state: SonaClassroomState, limit = 12): string {
  return state.recentEvents
    .slice(-limit)
    .map((e) => `${e.speakerName} (${e.speakerRole}): ${e.text}`)
    .join('\n');
}

/** The actual utterances behind a signal's evidence ids, for the teacher's card. */
export function quotesFor(
  state: SonaClassroomState,
  evidenceIds: string[],
): string[] {
  return evidenceIds
    .map((id) => state.recentEvents.find((e) => e.id === id)?.text)
    .filter((t): t is string => Boolean(t));
}
