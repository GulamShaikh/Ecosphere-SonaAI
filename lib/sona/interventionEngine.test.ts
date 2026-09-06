/**
 * Intervention engine tests.
 *
 * These encode the product's promises as assertions. If one of these fails, SonaAI is no
 * longer the thing we said it was — treat it as a product regression, not a test to update.
 *
 * Run: pnpm test   (no keys, no network, no Agora, no browser)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, aiStateFor, DEFAULT_POLICY } from './interventionEngine';
import type {
  ConversationEvent,
  InterventionDecision,
  LearningSignal,
  SonaClassroomState,
} from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function event(over: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    speakerId: 'Student A',
    speakerRole: 'student',
    speakerName: 'Student A',
    text: 'I am confused',
    type: 'utterance',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

function state(over: Partial<SonaClassroomState> = {}): SonaClassroomState {
  return {
    sessionId: 's1',
    lessonContext: {
      topic: "Newton's Second Law",
      stage: 'explanation',
      recentConcepts: ['mass', 'acceleration'],
      updatedAt: new Date().toISOString(),
    },
    recentEvents: [],
    learningSignals: [],
    aiMode: 'ASK',
    aiState: 'LISTENING',
    pendingIntervention: null,
    interventionHistory: [],
    teacherIsSpeaking: false,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function signal(over: Partial<LearningSignal> = {}): LearningSignal {
  return {
    id: 'sig1',
    sessionId: 's1',
    type: 'REPEATED_CONFUSION',
    concept: 'mass',
    affectedStudents: ['Student A', 'Student B'],
    confidence: 0.82,
    evidence: ['e1', 'e2'],
    timestamp: new Date().toISOString(),
    ...over,
  };
}

function past(over: Partial<InterventionDecision> = {}): InterventionDecision {
  return {
    id: 'd0',
    sessionId: 's1',
    action: 'ASK',
    reason: 'earlier ask',
    signalId: 'sig0',
    concept: 'mass',
    confidence: 0.8,
    teacherResponse: null,
    spokenText: null,
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    ...over,
  };
}

// ─── The promises ────────────────────────────────────────────────────────────

test('MUTE beats everything, including a direct request', () => {
  const d = decide({
    state: state({ aiMode: 'MUTE' }),
    signal: signal({ confidence: 0.99 }),
    directlyAddressed: true,
  });
  assert.equal(d.action, 'MUTE');
});

test('does not speak while the teacher is speaking — the core claim', () => {
  const s = state({ aiMode: 'AUTO', teacherIsSpeaking: true });
  const d = decide({ state: s, signal: signal({ confidence: 0.95 }), directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
  assert.match(d.reason, /teacher is explaining/i);
});

test('stays quiet during the grace window after the teacher stops', () => {
  const s = state({
    aiMode: 'AUTO',
    recentEvents: [
      event({ speakerRole: 'teacher', speakerId: 'Teacher', timestamp: new Date().toISOString() }),
    ],
  });
  const d = decide({ state: s, signal: signal({ confidence: 0.95 }), directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
});

test('speaks in AUTO once the teacher has paused and confidence is high', () => {
  const s = state({
    aiMode: 'AUTO',
    recentEvents: [
      event({
        speakerRole: 'teacher',
        speakerId: 'Teacher',
        timestamp: new Date(Date.now() - 30_000).toISOString(),
      }),
    ],
  });
  const d = decide({ state: s, signal: signal({ confidence: 0.9 }), directlyAddressed: false });
  assert.equal(d.action, 'SPEAK');
});

test('asks rather than speaks in ASK mode, however confident', () => {
  const d = decide({
    state: state({ aiMode: 'ASK' }),
    signal: signal({ confidence: 0.99 }),
    directlyAddressed: false,
  });
  assert.equal(d.action, 'ASK');
});

test('a declined concept is not raised again', () => {
  const s = state({
    aiMode: 'AUTO',
    interventionHistory: [past({ concept: 'mass', teacherResponse: 'DENY' })],
  });
  const d = decide({ state: s, signal: signal({ concept: 'mass', confidence: 0.95 }), directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
  assert.match(d.reason, /declined/i);
});

test('cooldown suppresses back-to-back interventions', () => {
  const s = state({
    aiMode: 'AUTO',
    interventionHistory: [
      past({
        action: 'SPEAK',
        reason: 'spoke',
        signalId: null,
        concept: 'acceleration',
        confidence: 0.9,
        spokenText: 'x',
        timestamp: new Date(Date.now() - 5_000).toISOString(),
      }),
    ],
  });
  const d = decide({ state: s, signal: signal({ confidence: 0.95 }), directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
  assert.match(d.reason, /waiting/i);
});

test('weak signals do not reach the teacher', () => {
  const d = decide({ state: state(), signal: signal({ confidence: 0.3 }), directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
  assert.ok(DEFAULT_POLICY.minConfidence > 0.3);
});

test('a direct question is answered even with no signal', () => {
  const d = decide({ state: state({ aiMode: 'AUTO' }), signal: null, directlyAddressed: true });
  assert.equal(d.action, 'SPEAK');
});

test('a direct student question still needs approval in ASK mode', () => {
  const d = decide({ state: state({ aiMode: 'ASK' }), signal: null, directlyAddressed: true });
  assert.equal(d.action, 'ASK');
});

test('no signal and nobody asking means silence', () => {
  const d = decide({ state: state(), signal: null, directlyAddressed: false });
  assert.equal(d.action, 'WAIT');
});

test('every decision carries a reason a teacher can read', () => {
  for (const mode of ['AUTO', 'ASK', 'MUTE'] as const) {
    const d = decide({ state: state({ aiMode: mode }), signal: signal(), directlyAddressed: false });
    assert.ok(d.reason.length > 0, `${mode} produced an empty reason`);
  }
});

test('decisions map onto the right UI state', () => {
  assert.equal(aiStateFor({ action: 'MUTE' } as never), 'MUTED');
  assert.equal(aiStateFor({ action: 'SPEAK' } as never), 'SPEAKING');
  assert.equal(aiStateFor({ action: 'ASK' } as never), 'ASKING');
  assert.equal(aiStateFor({ action: 'WAIT' } as never), 'WAITING');
});
