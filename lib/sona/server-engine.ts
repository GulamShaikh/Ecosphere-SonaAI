import { randomUUID } from 'node:crypto';
import type {
  AiMode,
  ConversationEvent,
  InterventionAction,
  InterventionDecision,
  LearningSignal,
  SonaClassroomState,
} from './types';

type CompletionInput = {
  channel?: string;
  userId?: string;
  messages: Array<{ role: string; content?: unknown }>;
};

const states = new Map<string, SonaClassroomState>();
const requestedModes = new Map<string, AiMode>();
const confusionMarkers = [
  "i don't get",
  'i dont get',
  "don't understand",
  'dont understand',
  'confused',
  'not clear',
  'unclear',
  'what do you mean',
  'can you repeat',
  'why does',
  'why is',
  'how come',
  'i thought',
];
const conceptWords = [
  'acceleration',
  'velocity',
  'momentum',
  'inertia',
  'friction',
  'gravity',
  'mass',
  'force',
  'newton',
  'equation',
  'variable',
];

function mode(): AiMode {
  const value = process.env.SONA_AI_MODE;
  return value === 'AUTO' || value === 'MUTE' ? value : 'ASK';
}

export function setSonaMode(channel: string, aiMode: AiMode): void {
  requestedModes.set(channel, aiMode);
  const state = states.get(channel);
  if (!state) return;
  state.aiMode = aiMode;
  state.aiState = aiMode === 'MUTE' ? 'MUTED' : 'LISTENING';
  state.pendingIntervention = null;
}

function getState(channel: string): SonaClassroomState {
  const existing = states.get(channel);
  if (existing) return existing;

  const now = new Date().toISOString();
  const state: SonaClassroomState = {
    sessionId: channel,
    lessonContext: {
      topic: 'the current lesson',
      stage: 'intro',
      recentConcepts: [],
      updatedAt: now,
    },
    recentEvents: [],
    learningSignals: [],
    aiMode: requestedModes.get(channel) ?? mode(),
    aiState: 'LISTENING',
    pendingIntervention: null,
    interventionHistory: [],
    teacherIsSpeaking: false,
    updatedAt: now,
  };
  states.set(channel, state);
  return state;
}

function lastUserMessage(messages: CompletionInput['messages']): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    const text = message.content.trim();
    if (text) return text;
  }
  return null;
}

function recordEvent(state: SonaClassroomState, text: string, userId: string): ConversationEvent {
  const isTeacher = userId === '1';
  const event: ConversationEvent = {
    id: randomUUID(),
    sessionId: state.sessionId,
    speakerId: userId,
    speakerRole: isTeacher ? 'teacher' : 'student',
    speakerName: isTeacher ? 'Teacher' : 'Student',
    text,
    type: text.includes('?') ? 'question' : 'utterance',
    timestamp: new Date().toISOString(),
  };
  state.recentEvents = [...state.recentEvents, event].slice(-40);
  state.teacherIsSpeaking = isTeacher;

  if (isTeacher) {
    const lower = text.toLowerCase();
    const concepts = conceptWords.filter((concept) => lower.includes(concept));
    state.lessonContext.recentConcepts = [
      ...concepts,
      ...state.lessonContext.recentConcepts,
    ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 8);
    if (concepts[0]) state.lessonContext.topic = concepts[0];
  }

  state.updatedAt = new Date().toISOString();
  return event;
}

function signalFor(state: SonaClassroomState, event: ConversationEvent): LearningSignal | null {
  const lower = event.text.toLowerCase();
  if (lower.includes('sonaai') || lower.includes('sona ai') || lower.includes('sona,')) {
    return {
      id: randomUUID(),
      sessionId: state.sessionId,
      type: 'DIRECT_REQUEST',
      concept: state.lessonContext.recentConcepts[0] ?? state.lessonContext.topic,
      affectedStudents: event.speakerRole === 'student' ? [event.speakerId] : [],
      confidence: 0.95,
      evidence: [event.id],
      timestamp: new Date().toISOString(),
    };
  }

  if (event.speakerRole !== 'student' || !confusionMarkers.some((marker) => lower.includes(marker))) {
    return null;
  }

  const recentConfusion = state.recentEvents.filter(
    (candidate) =>
      candidate.speakerRole === 'student' &&
      confusionMarkers.some((marker) => candidate.text.toLowerCase().includes(marker)),
  );
  const students = [...new Set(recentConfusion.map((candidate) => candidate.speakerId))];
  if (students.length < 2) return null;

  return {
    id: randomUUID(),
    sessionId: state.sessionId,
    type: 'REPEATED_CONFUSION',
    concept: state.lessonContext.recentConcepts[0] ?? state.lessonContext.topic,
    affectedStudents: students,
    confidence: Math.min(0.95, 0.55 + students.length * 0.12),
    evidence: recentConfusion.map((candidate) => candidate.id),
    timestamp: new Date().toISOString(),
  };
}

function decide(state: SonaClassroomState, signal: LearningSignal | null): InterventionDecision {
  const action: InterventionAction =
    state.aiMode === 'MUTE'
      ? 'MUTE'
      : signal?.type === 'DIRECT_REQUEST'
        ? state.aiMode === 'ASK' ? 'ASK' : 'SPEAK'
        : !signal
          ? 'WAIT'
          : state.aiMode === 'AUTO' && signal.confidence >= 0.75
            ? 'SPEAK'
            : 'ASK';
  const reason =
    action === 'MUTE'
      ? 'Teacher has muted SonaAI'
      : action === 'SPEAK'
        ? 'A participant asked SonaAI directly'
        : action === 'ASK'
          ? `Students may be stuck on ${signal?.concept ?? 'this concept'}`
          : 'Following the lesson';
  return {
    id: randomUUID(),
    sessionId: state.sessionId,
    action,
    reason,
    signalId: signal?.id ?? null,
    concept: signal?.concept ?? null,
    confidence: signal?.confidence ?? 0,
    teacherResponse: null,
    spokenText: null,
    timestamp: new Date().toISOString(),
  };
}

async function generateReply(state: SonaClassroomState, signal: LearningSignal | null): Promise<string> {
  const concept = signal?.concept ?? state.lessonContext.topic;
  const apiKey = process.env.NEXT_LLM_API_KEY;
  const llmUrl = process.env.NEXT_LLM_URL;
  if (apiKey && llmUrl) {
    try {
      const response = await fetch(llmUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.NEXT_LLM_MODEL ?? 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Give one concise spoken classroom explanation under 25 seconds. No lists or markdown.' },
            { role: 'user', content: `Explain ${concept} using one concrete analogy.` },
          ],
          max_tokens: 120,
          temperature: 0.4,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (error) {
      console.error('[sonaai] wording model unavailable; using fallback:', error);
    }
  }

  const canned: Record<string, string> = {
    mass: 'Think of pushing an empty cart versus a loaded cart with the same effort. The loaded cart speeds up more slowly.',
    acceleration: 'Acceleration is how quickly speed changes, not simply how fast something is moving.',
    force: 'Force is a push or a pull. More force on the same object produces more acceleration.',
  };
  return Object.entries(canned).find(([key]) => concept.toLowerCase().includes(key))?.[1]
    ?? `Here is another way to think about ${concept}. Let us take it one step at a time.`;
}

export async function processSonaCompletion(input: CompletionInput): Promise<string> {
  const channel = input.channel?.trim();
  if (!channel) return '';
  const text = lastUserMessage(input.messages);
  if (!text) return '';

  const state = getState(channel);
  const event = recordEvent(state, text, input.userId ?? 'unknown');

  // Teacher-approved interventions use the same Agora text path as classroom turns.
  // This explicit phrase is the server-side speech gate for the custom LLM path.
  if (text.toLowerCase().includes('the teacher has approved you to help')) {
    const concept = text.match(/explain ["']([^"']+)["']/i)?.[1];
    if (concept) state.lessonContext.topic = concept;
    state.aiState = 'SPEAKING';
    return generateReply(state, null);
  }

  const signal = signalFor(state, event);
  if (signal) state.learningSignals.push(signal);
  const decision = decide(state, signal);
  state.aiState = decision.action === 'MUTE' ? 'MUTED' : decision.action === 'SPEAK' ? 'SPEAKING' : decision.action === 'ASK' ? 'ASKING' : 'WAITING';
  state.pendingIntervention = decision.action === 'ASK' ? decision : null;
  state.interventionHistory.push(decision);

  if (decision.action !== 'SPEAK') return '';
  const reply = await generateReply(state, signal);
  decision.spokenText = reply;
  return reply;
}

export function clearSonaSession(channel?: string): void {
  if (channel) {
    states.delete(channel);
    requestedModes.delete(channel);
  } else {
    states.clear();
    requestedModes.clear();
  }
}
