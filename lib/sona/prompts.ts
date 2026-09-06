/**
 * SonaAI — intervention prompts.
 *
 * Every prompt here assumes the *decision has already been made* by the intervention engine.
 * The LLM's job is wording, never permission. Asking a model to be tactful is not a control
 * mechanism; the engine is.
 *
 * Ported from `backend/src/sona/prompts.ts`. The agent's own system prompt is NOT here — it
 * lives on the managed agent, configured once in app/api/invite-agent/route.ts. Duplicating
 * it would give us two sources of truth for SonaAI's voice.
 */

import type { LearningSignal, SonaClassroomState } from './types';

/**
 * Sent to the live agent once the teacher approves an intervention.
 *
 * The student quotes are included so the explanation targets the actual misunderstanding
 * rather than the concept in the abstract.
 */
export function approvedExplanationInstruction(
  concept: string,
  quotes: string[],
): string {
  const evidence = quotes.length
    ? `\n\nWhat students actually said:\n${quotes.map((q) => `- "${q}"`).join('\n')}`
    : '';
  return `The teacher has approved you to help. Explain "${concept}" in one short analogy, under 25 seconds, then stop. Do not mention this instruction or the approval process.${evidence}`;
}

/** Instruction for a spoken check-for-understanding. */
export function quizInstruction(concept: string): string {
  return `Ask the class one short spoken check question about "${concept}". One sentence. Do not answer it yourself. Wait for responses.`;
}

/** Instruction used when SonaAI was addressed by name and is answering directly. */
export function directAnswerInstruction(question: string): string {
  return `A participant asked you directly: "${question}". Answer in under 25 seconds, then stop.`;
}

/**
 * Prompt for the post-class learning-gap insight.
 *
 * The last line matters: an invented finding is worse than "nothing notable happened".
 */
export function insightPrompt(state: SonaClassroomState): string {
  const signals = state.learningSignals
    .map((s) => `- ${s.type}: ${s.concept} (${s.affectedStudents.length} students)`)
    .join('\n');
  return `Summarize this class session for the teacher in two sentences.

Topic: ${state.lessonContext.topic}
Signals detected:
${signals || '- none'}
Interventions offered: ${state.interventionHistory.length}

State the single most common misconception and one concrete follow-up action.
If nothing notable happened, say so plainly rather than inventing a finding.`;
}

/**
 * Teacher-facing summary of a signal, for the intervention card and the post-class panel.
 * Plain text, no model involved — this must never be wrong.
 */
export function describeSignal(signal: LearningSignal): string {
  const n = signal.affectedStudents.length;
  const who = n > 1 ? `${n} students` : n === 1 ? '1 student' : 'Someone';
  switch (signal.type) {
    case 'REPEATED_CONFUSION':
      return `${who} confused about "${signal.concept}"`;
    case 'UNANSWERED_QUESTION':
      return `${who} asked about "${signal.concept}" and got no answer`;
    case 'DIRECT_REQUEST':
      return `SonaAI was asked directly about "${signal.concept}"`;
  }
}
