'use client';

/**
 * ClassroomInterventionCard — SonaAI asking permission.
 *
 * Three things have to be on this card for a teacher to trust it in the middle of a lesson:
 * what SonaAI thinks is wrong, the *evidence* it thinks it from, and two buttons. No settings,
 * no explanation of the model, nothing to read twice. If the teacher ignores it, nothing
 * happens — silence is the safe default.
 */

import { Check, Sparkles, X } from 'lucide-react';
import type { InterventionDecision } from '@/lib/sona/types';

export type ClassroomInterventionCardProps = {
  decision: InterventionDecision;
  /** The students' own words, so the teacher judges the situation and not the AI's summary. */
  quotes: string[];
  onAllow: () => void;
  onDeny: () => void;
};

export function ClassroomInterventionCard({
  decision,
  quotes,
  onAllow,
  onDeny,
}: ClassroomInterventionCardProps) {
  const confidencePct = Math.round(decision.confidence * 100);

  return (
    <div
      className="animate-slide-up-enter w-full max-w-md rounded-3xl border border-[#D0FFA2]/40 bg-[#052329]/95 p-5 shadow-2xl backdrop-blur-md"
      role="alertdialog"
      aria-live="polite"
      aria-label="SonaAI is asking permission to help"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#D0FFA2]">
          <Sparkles className="h-4 w-4 text-[#031A10]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#D0FFA2]/70">
            SonaAI would like to help
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-white">
            {decision.reason}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70">
          {confidencePct}%
        </span>
      </div>

      {quotes.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-l-2 border-[#D0FFA2]/30 pl-3">
          {quotes.slice(-3).map((quote, i) => (
            <li key={i} className="text-xs italic leading-relaxed text-white/60">
              &ldquo;{quote}&rdquo;
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onAllow}
          autoFocus
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#D0FFA2] px-4 py-2.5 text-sm font-bold text-[#031A10] transition-transform hover:scale-[1.02] active:scale-95"
        >
          <Check className="h-4 w-4" />
          Allow
        </button>
        <button
          type="button"
          onClick={onDeny}
          className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
          Not now
        </button>
      </div>
    </div>
  );
}
