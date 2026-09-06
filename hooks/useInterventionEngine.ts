'use client';

/**
 * useInterventionEngine — runs the SonaAI Intervention Engine against the live classroom.
 *
 * WHERE THIS RUNS: the teacher's client only. Every participant broadcasts its completed
 * transcript turns over RTM, so the teacher's browser is the one place that sees the whole
 * attributed conversation. Running the engine on every client would give the classroom
 * several decision-makers that disagree.
 *
 * WHAT IT CONTROLS: the *proactive* path — SonaAI volunteering help nobody asked for. The
 * Agora managed agent runs its own STT→LLM→TTS loop and will still answer a question put to
 * it directly; we do not pretend otherwise (see `shouldInject` below). MUTE mode is enforced
 * by also stopping the agent session, which is the only way to make "never speak" true.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyClassroomState,
  quotesFor,
  recordEvent,
} from '@/lib/sona/context';
import {
  aiStateFor,
  decide,
  DEFAULT_POLICY,
} from '@/lib/sona/interventionEngine';
import { detectSignal, isDirectlyAddressed } from '@/lib/sona/signals';
import { approvedExplanationInstruction } from '@/lib/sona/prompts';
import type {
  AiMode,
  AiState,
  InterventionDecision,
  LearningSignal,
  SonaClassroomState,
} from '@/lib/sona/types';
import type { TranscriptTurn } from '@/types/conversation';

/** How often we re-evaluate without a new utterance, for the time-based rules. */
const TICK_MS = 2_000;

/** Local mic polling for "is the teacher talking right now". */
const VOLUME_POLL_MS = 250;

/** getVolumeLevel() is 0–1; anything above this is speech rather than room noise. */
const SPEAKING_THRESHOLD = 0.05;

/** How long the teacher's tile stays "speaking" after the level drops, to ride out pauses. */
const SPEAKING_RELEASE_MS = 700;

/** Signals and decisions kept for the teacher's panel. */
const PANEL_HISTORY = 12;

interface VolumeSource {
  getVolumeLevel: () => number;
}

export interface UseInterventionEngineOptions {
  /** The Agora channel doubles as the session id. */
  sessionId: string;
  /** Teacher's chosen permission level. */
  aiMode: AiMode;
  /**
   * False on student clients and before the channel is joined. When false the engine holds
   * state but never evaluates, so nothing is decided twice.
   */
  enabled: boolean;
  /** The local mic track, used only when the local user IS the teacher. */
  localMicrophoneTrack?: VolumeSource | null;
  /**
   * Called when SonaAI should actually say something. Receives a ready-to-send instruction
   * for the live agent. Only fired for interventions SonaAI initiated — never for questions
   * the agent was already asked directly and is already answering.
   */
  onSpeak: (instruction: string, decision: InterventionDecision) => void | Promise<void>;
}

export interface InterventionEngineApi {
  aiState: AiState;
  /** Non-null while SonaAI is waiting for the teacher to allow or decline. */
  pendingIntervention: InterventionDecision | null;
  /** The actual student quotes behind the pending card. */
  pendingQuotes: string[];
  /** The most recent decision, including WAITs — this is what makes restraint visible. */
  lastDecision: InterventionDecision | null;
  signals: LearningSignal[];
  history: InterventionDecision[];
  lessonConcepts: string[];
  teacherIsSpeaking: boolean;
  /** Feed every completed transcript turn here, local or remote. */
  ingestTurn: (turn: TranscriptTurn) => void;
  allow: () => void;
  deny: () => void;
}

export function useInterventionEngine({
  sessionId,
  aiMode,
  enabled,
  localMicrophoneTrack,
  onSpeak,
}: UseInterventionEngineOptions): InterventionEngineApi {
  // The engine's working state lives in a ref: context.ts mutates it in place, and mutating
  // React state would be a lie. Snapshots below are what render.
  const stateRef = useRef<SonaClassroomState>(
    emptyClassroomState(sessionId, 'the current topic'),
  );

  // Turns can arrive twice — once locally from TRANSCRIPT_UPDATED and once over RTM if the
  // channel echoes our own publish. Ingesting the same utterance twice would inflate the
  // confusion count and fabricate a pattern, so dedupe before it reaches the state.
  const seenTurns = useRef(new Set<string>());

  const onSpeakRef = useRef(onSpeak);
  useEffect(() => {
    onSpeakRef.current = onSpeak;
  }, [onSpeak]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Rendered snapshots.
  const [aiState, setAiState] = useState<AiState>('LISTENING');
  const [pendingIntervention, setPendingIntervention] =
    useState<InterventionDecision | null>(null);
  const [pendingQuotes, setPendingQuotes] = useState<string[]>([]);
  const [lastDecision, setLastDecision] = useState<InterventionDecision | null>(null);
  const [signals, setSignals] = useState<LearningSignal[]>([]);
  const [history, setHistory] = useState<InterventionDecision[]>([]);
  const [lessonConcepts, setLessonConcepts] = useState<string[]>([]);
  const [teacherIsSpeaking, setTeacherIsSpeaking] = useState(false);

  // Keep the engine's copy of the mode in sync. `decide` reads it from state, not from props,
  // so that the pure function stays the single source of policy.
  useEffect(() => {
    stateRef.current.aiMode = aiMode;
    if (aiMode === 'MUTE') {
      // Drop anything awaiting an answer: a muted SonaAI has no pending offer.
      stateRef.current.pendingIntervention = null;
      setPendingIntervention(null);
      setPendingQuotes([]);
      setAiState('MUTED');
    }
  }, [aiMode]);

  const publish = useCallback(() => {
    const s = stateRef.current;
    setSignals(s.learningSignals.slice(-PANEL_HISTORY).reverse());
    setHistory(s.interventionHistory.slice(-PANEL_HISTORY).reverse());
    setLessonConcepts([...s.lessonContext.recentConcepts]);
  }, []);

  /**
   * Evaluate the policy once.
   *
   * Called on every ingested turn and on a timer, because three of the eight rules are
   * time-based (the teacher's grace window, the cooldown, and an unanswered question
   * ripening). An event-only trigger would leave a signal stuck at WAIT forever in a silent
   * room, which is exactly the moment SonaAI is most useful.
   */
  const evaluate = useCallback(() => {
    if (!enabledRef.current) return;
    const state = stateRef.current;

    // One question at a time. While the teacher has a card in front of them, re-deciding
    // would either swap the card out from under their cursor or stack up offers.
    if (state.pendingIntervention) return;

    const signal = detectSignal(state);
    const directlyAddressed = isDirectlyAddressed(state);

    const decision = decide({ state, signal, directlyAddressed }, DEFAULT_POLICY);

    // Record the signal once, so the teacher's panel can show what SonaAI noticed even when
    // the answer was to stay quiet. Restraint you cannot see looks like a broken feature.
    if (signal && !state.learningSignals.some((s) => s.id === signal.id)) {
      const isNew = !state.learningSignals.some(
        (s) => s.type === signal.type && s.concept === signal.concept,
      );
      if (isNew) state.learningSignals.push(signal);
    }

    state.aiState = aiStateFor(decision);
    setAiState(state.aiState);
    setLastDecision(decision);

    if (decision.action === 'ASK') {
      state.pendingIntervention = decision;
      setPendingIntervention(decision);
      setPendingQuotes(signal ? quotesFor(state, signal.evidence) : []);
    }

    if (decision.action === 'SPEAK') {
      state.interventionHistory.push(decision);

      // A direct question is already on its way to the agent's own pipeline — it heard the
      // student itself. Injecting our instruction too would make SonaAI answer twice.
      const shouldInject = !directlyAddressed && signal !== null;
      if (shouldInject) {
        const instruction = approvedExplanationInstruction(
          signal.concept,
          quotesFor(state, signal.evidence),
        );
        decision.spokenText = instruction;
        void onSpeakRef.current(instruction, decision);
      }
    }

    publish();
  }, [publish]);

  const ingestTurn = useCallback(
    (turn: TranscriptTurn) => {
      const text = turn.text?.trim();
      if (!text) return;

      const key = `${turn.role}|${turn.name}|${turn.timestamp}|${text}`;
      if (seenTurns.current.has(key)) return;
      seenTurns.current.add(key);

      const state = stateRef.current;
      recordEvent(state, {
        sessionId: state.sessionId,
        // RTM turns carry display names, not user ids, so the name IS the speaker id.
        speakerId: turn.name,
        speakerRole: turn.role,
        speakerName: turn.name,
        text,
        timestamp: new Date(turn.timestamp).toISOString(),
      });

      publish();
      evaluate();
    },
    [evaluate, publish],
  );

  /** Teacher approves the offer: record it, then let SonaAI explain. */
  const allow = useCallback(() => {
    const state = stateRef.current;
    const decision = state.pendingIntervention;
    if (!decision) return;

    decision.teacherResponse = 'ALLOW';
    state.interventionHistory.push(decision);
    state.pendingIntervention = null;
    state.aiState = 'SPEAKING';

    const signal = state.learningSignals.find((s) => s.id === decision.signalId);
    const concept = decision.concept ?? signal?.concept ?? 'the current topic';
    const instruction = approvedExplanationInstruction(
      concept,
      signal ? quotesFor(state, signal.evidence) : [],
    );
    decision.spokenText = instruction;

    setPendingIntervention(null);
    setPendingQuotes([]);
    setAiState('SPEAKING');
    publish();

    void onSpeakRef.current(instruction, decision);
  }, [publish]);

  /** Teacher declines. Rule 4 makes sure this concept is not raised again this session. */
  const deny = useCallback(() => {
    const state = stateRef.current;
    const decision = state.pendingIntervention;
    if (!decision) return;

    decision.teacherResponse = 'DENY';
    state.interventionHistory.push(decision);
    state.pendingIntervention = null;
    state.aiState = 'LISTENING';

    setPendingIntervention(null);
    setPendingQuotes([]);
    setAiState('LISTENING');
    publish();
  }, [publish]);

  // Poll the local mic so Rule 3 has a live answer rather than only the 4s grace window after
  // the teacher's last transcribed turn. This is what makes "SonaAI stayed silent while I was
  // explaining" observable in the moment instead of after the fact.
  useEffect(() => {
    if (!enabled || !localMicrophoneTrack) {
      stateRef.current.teacherIsSpeaking = false;
      setTeacherIsSpeaking(false);
      return;
    }

    let lastLoud = 0;
    const id = setInterval(() => {
      let level = 0;
      try {
        level = localMicrophoneTrack.getVolumeLevel();
      } catch {
        return; // track closed mid-poll; the next tick will settle it
      }

      const now = Date.now();
      if (level > SPEAKING_THRESHOLD) lastLoud = now;
      const speaking = now - lastLoud < SPEAKING_RELEASE_MS;

      if (speaking !== stateRef.current.teacherIsSpeaking) {
        stateRef.current.teacherIsSpeaking = speaking;
        setTeacherIsSpeaking(speaking);
      }
    }, VOLUME_POLL_MS);

    return () => clearInterval(id);
  }, [enabled, localMicrophoneTrack]);

  // The heartbeat for the time-based rules.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(evaluate, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, evaluate]);

  return useMemo(
    () => ({
      aiState,
      pendingIntervention,
      pendingQuotes,
      lastDecision,
      signals,
      history,
      lessonConcepts,
      teacherIsSpeaking,
      ingestTurn,
      allow,
      deny,
    }),
    [
      aiState,
      pendingIntervention,
      pendingQuotes,
      lastDecision,
      signals,
      history,
      lessonConcepts,
      teacherIsSpeaking,
      ingestTurn,
      allow,
      deny,
    ],
  );
}
