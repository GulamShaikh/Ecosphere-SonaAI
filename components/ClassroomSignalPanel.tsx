'use client';

/**
 * ClassroomSignalPanel — the teacher's view into what SonaAI noticed and what it decided.
 *
 * This panel exists because the engine's best behaviour is invisible: a signal detected and
 * deliberately not acted on produces no sound and no card. Without this the teacher has no way
 * to tell restraint from failure, and "it stayed quiet" is the claim the whole product rests on.
 *
 * Everything here is rendered from the engine's own data — the reason strings, the confidence,
 * the students' quotes. No model is asked to describe its own behaviour.
 */

import { Ban, Check, Mic, Pause, Sparkles } from 'lucide-react';
import { describeSignal } from '@/lib/sona/prompts';
import { ClassroomAiStateBadge } from './ClassroomAiStateBadge';
import type {
  AiMode,
  AiState,
  InterventionDecision,
  LearningSignal,
} from '@/lib/sona/types';

export type ClassroomSignalPanelProps = {
  aiMode: AiMode;
  aiState: AiState;
  lastDecision: InterventionDecision | null;
  signals: LearningSignal[];
  history: InterventionDecision[];
  lessonConcepts: string[];
  teacherIsSpeaking: boolean;
};

const MODE_BLURB: Record<AiMode, string> = {
  AUTO: 'SonaAI may step in on its own when it is confident, and still holds back while you are explaining.',
  ASK: 'SonaAI will ask before it says anything. Nothing is spoken without your tap.',
  MUTE: 'SonaAI has left the class. It cannot speak until you bring it back.',
};

export function ClassroomSignalPanel({
  aiMode,
  aiState,
  lastDecision,
  signals,
  history,
  lessonConcepts,
  teacherIsSpeaking,
}: ClassroomSignalPanelProps) {
  const resolved = history.filter((d) => d.teacherResponse !== null || d.action === 'SPEAK');

  return (
    <div className="flex flex-col gap-4">
      {/* Right now */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#031A10]">
            <Sparkles className="h-4 w-4 text-green-500" /> SonaAI Co-Teacher
          </p>
          <ClassroomAiStateBadge state={aiState} reason={lastDecision?.reason} />
        </div>

        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          {MODE_BLURB[aiMode]}
        </p>

        {lastDecision && aiMode !== 'MUTE' && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#F8F9FA] p-3">
            <Pause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
            <p className="text-xs leading-relaxed text-gray-600">
              <span className="font-semibold text-[#031A10]">Latest decision: </span>
              {lastDecision.reason}
            </p>
          </div>
        )}

        {teacherIsSpeaking && (
          <p className="mt-2 text-[11px] font-semibold text-amber-600">
            You are speaking — SonaAI will not interrupt.
          </p>
        )}
      </div>

      {/* What the lesson is about, as SonaAI understands it */}
      <div className="rounded-2xl border border-gray-100 bg-white/50 p-4">
        <h4 className="mb-2 text-xs font-bold text-[#031A10]">Concepts in play</h4>
        {lessonConcepts.length === 0 ? (
          <p className="text-xs text-gray-400">
            Nothing yet — concepts are picked up from what you say as you teach.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lessonConcepts.map((c) => (
              <span
                key={c}
                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Learning signals */}
      <div className="rounded-2xl border border-gray-100 bg-white/50 p-4">
        <h4 className="mb-2 text-xs font-bold text-[#031A10]">Learning signals</h4>
        {signals.length === 0 ? (
          <p className="text-xs text-gray-400">
            No gaps detected. SonaAI needs the same confusion twice before it calls it a pattern.
          </p>
        ) : (
          <ul className="space-y-2">
            {signals.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-gray-100 bg-white p-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold leading-snug text-[#031A10]">
                    {describeSignal(s)}
                  </p>
                  <span className="shrink-0 text-[10px] font-bold text-gray-400">
                    {Math.round(s.confidence * 100)}%
                  </span>
                </div>
                {s.affectedStudents.length > 0 && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    {s.affectedStudents.join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Interventions */}
      <div className="rounded-2xl border border-gray-100 bg-white/50 p-4">
        <h4 className="mb-2 text-xs font-bold text-[#031A10]">Interventions</h4>
        {resolved.length === 0 ? (
          <p className="text-xs text-gray-400">
            SonaAI has not spoken yet this session.
          </p>
        ) : (
          <ul className="space-y-2">
            {resolved.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                {d.teacherResponse === 'DENY' ? (
                  <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                ) : d.action === 'SPEAK' ? (
                  <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                ) : (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                )}
                <div className="min-w-0">
                  <p className="text-xs leading-snug text-gray-700">{d.reason}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {d.teacherResponse === 'DENY'
                      ? 'You declined'
                      : d.teacherResponse === 'ALLOW'
                        ? 'You allowed'
                        : 'Spoke automatically'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
