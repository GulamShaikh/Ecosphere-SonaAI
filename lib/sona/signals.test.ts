/**
 * Signal detection tests.
 *
 * The threshold assertions below are the ones that matter: they are what stops SonaAI
 * interrupting a class the first time one student says "huh?".
 *
 * Run: pnpm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSignal, isDirectlyAddressed, MIN_CONFUSED_STUDENTS } from './signals';
import { emptyClassroomState, recordEvent } from './context';
import type { SonaClassroomState } from './types';

const NOW = Date.parse('2026-01-01T10:00:00.000Z');

function classroom(): SonaClassroomState {
  const s = emptyClassroomState('channel-1', "Newton's Second Law");
  s.lessonContext.recentConcepts = ['acceleration', 'mass'];
  return s;
}

/** Add an utterance at a fixed offset before NOW, so time-based rules are deterministic. */
function say(
  state: SonaClassroomState,
  speakerName: string,
  role: 'teacher' | 'student' | 'agent',
  text: string,
  secondsAgo = 10,
) {
  return recordEvent(state, {
    sessionId: state.sessionId,
    speakerId: speakerName,
    speakerRole: role,
    speakerName,
    text,
    timestamp: new Date(NOW - secondsAgo * 1000).toISOString(),
  });
}

test('one student saying it once is not a signal — it is a question for the teacher', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', "I don't get acceleration");
  assert.equal(detectSignal(s, { now: NOW }), null);
  assert.equal(MIN_CONFUSED_STUDENTS, 2);
});

test('two different students confused is a pattern', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', "I don't get acceleration", 40);
  say(s, 'Rohan', 'student', 'I am confused about acceleration too', 20);

  const sig = detectSignal(s, { now: NOW });
  assert.ok(sig, 'expected a signal');
  assert.equal(sig.type, 'REPEATED_CONFUSION');
  assert.equal(sig.concept, 'acceleration');
  assert.equal(sig.affectedStudents.length, 2);
  assert.equal(sig.evidence.length, 2, 'the teacher must be able to see both quotes');
});

test('the same student saying it twice is also a pattern, but a weaker one', () => {
  const one = classroom();
  say(one, 'Aisha', 'student', "I don't get acceleration", 40);
  say(one, 'Aisha', 'student', 'still confused', 20);
  const solo = detectSignal(one, { now: NOW });

  const two = classroom();
  say(two, 'Aisha', 'student', "I don't get acceleration", 40);
  say(two, 'Rohan', 'student', 'I am confused about acceleration', 20);
  const pair = detectSignal(two, { now: NOW });

  assert.ok(solo && pair);
  assert.equal(solo.type, 'REPEATED_CONFUSION');
  assert.ok(
    solo.confidence < pair.confidence,
    'one student twice must score below two students once',
  );
});

test('stale confusion falls out of the window', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', "I don't get acceleration", 600);
  say(s, 'Rohan', 'student', 'confused', 600);
  assert.equal(detectSignal(s, { now: NOW }), null);
});

test('a direct request outranks a confusion pattern', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', "I don't get acceleration", 40);
  say(s, 'Rohan', 'student', 'confused about acceleration', 30);
  say(s, 'Rohan', 'student', 'Sona, can you explain acceleration?', 5);

  const sig = detectSignal(s, { now: NOW });
  assert.ok(sig);
  assert.equal(sig.type, 'DIRECT_REQUEST');
  assert.ok(isDirectlyAddressed(s));
});

test('a fresh unanswered question is left to the teacher', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', 'Why is mass in the denominator?', 3);
  assert.equal(detectSignal(s, { now: NOW }), null);
});

test('a question nobody answered becomes a signal', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', 'Why is mass in the denominator?', 45);

  const sig = detectSignal(s, { now: NOW });
  assert.ok(sig);
  assert.equal(sig.type, 'UNANSWERED_QUESTION');
  assert.equal(sig.concept, 'mass');
});

test('a question the teacher answered is not a signal', () => {
  const s = classroom();
  say(s, 'Aisha', 'student', 'Why is mass in the denominator?', 45);
  say(s, 'Teacher', 'teacher', 'Because heavier objects resist acceleration.', 30);
  assert.equal(detectSignal(s, { now: NOW }), null);
});

test('the agent naming itself does not count as being addressed', () => {
  const s = classroom();
  say(s, 'SonaAI', 'agent', 'Sona here — happy to help.', 5);
  assert.equal(isDirectlyAddressed(s), false);
});

test('concepts come from the teacher, not from students', () => {
  const s = emptyClassroomState('channel-1', 'Motion');
  say(s, 'Aisha', 'student', 'is it about momentum?', 30);
  assert.equal(s.lessonContext.recentConcepts.length, 0);

  say(s, 'Teacher', 'teacher', 'Today we look at acceleration and force.', 20);
  assert.ok(s.lessonContext.recentConcepts.includes('acceleration'));
  assert.ok(s.lessonContext.recentConcepts.includes('force'));
});
