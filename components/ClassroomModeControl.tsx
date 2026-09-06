'use client';

/**
 * ClassroomModeControl — the teacher's permission dial.
 *
 * AUTO / ASK / MUTE, always visible, always one click away. The whole product rests on the
 * teacher believing they are in charge, so this control is never buried in a menu and never
 * shows a state it has not actually reached (see `isBusy`).
 *
 * Terminology is fixed by the SRS: do not rename these three modes.
 */

import { Loader2, MessageCircleQuestion, VolumeX, Zap } from 'lucide-react';
import type { AiMode } from '@/lib/sona/types';

const MODES: Array<{
  mode: AiMode;
  label: string;
  hint: string;
  Icon: typeof Zap;
}> = [
  {
    mode: 'AUTO',
    label: 'Auto',
    hint: 'SonaAI may help on its own when it is confident',
    Icon: Zap,
  },
  {
    mode: 'ASK',
    label: 'Ask',
    hint: 'SonaAI asks your permission before speaking',
    Icon: MessageCircleQuestion,
  },
  {
    mode: 'MUTE',
    label: 'Mute',
    hint: 'SonaAI leaves the class and cannot speak',
    Icon: VolumeX,
  },
];

export type ClassroomModeControlProps = {
  mode: AiMode;
  onChange: (mode: AiMode) => void;
  /** True while the MUTE transition is stopping or restarting the agent session. */
  isBusy?: boolean;
};

export function ClassroomModeControl({
  mode,
  onChange,
  isBusy = false,
}: ClassroomModeControlProps) {
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-white/10 bg-[#202124] p-1 shadow-lg"
      role="radiogroup"
      aria-label="SonaAI permission mode"
    >
      <span className="pl-2 pr-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
        SonaAI
      </span>
      {MODES.map(({ mode: m, label, hint, Icon }) => {
        const isActive = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${label} — ${hint}`}
            title={hint}
            disabled={isBusy}
            onClick={() => onChange(m)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isActive
                ? 'bg-[#D0FFA2] text-[#031A10]'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {isBusy && isActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
