'use client';

/**
 * ClassroomAiStateBadge — what SonaAI is doing right now, in one word.
 *
 * WAITING is the state that matters. A co-teacher that has noticed something and is
 * deliberately holding back is doing its most important work, and if that is invisible it
 * reads as a bug. So WAITING gets its own colour and its own reason text.
 */

import { Ear, Loader2, MessageCircleQuestion, Mic, Pause, VolumeX } from 'lucide-react';
import type { AiState } from '@/lib/sona/types';

const PRESENTATION: Record<
  AiState,
  { label: string; Icon: typeof Ear; fg: string; bg: string }
> = {
  LISTENING:    { label: 'Listening',     Icon: Ear,                    fg: '#D0FFA2', bg: 'rgba(208,255,162,0.15)' },
  UNDERSTANDING:{ label: 'Understanding', Icon: Loader2,                fg: '#D0FFA2', bg: 'rgba(208,255,162,0.15)' },
  WAITING:      { label: 'Waiting',       Icon: Pause,                  fg: '#FBBF24', bg: 'rgba(251,191,36,0.15)' },
  ASKING:       { label: 'Asking you',    Icon: MessageCircleQuestion,  fg: '#FBBF24', bg: 'rgba(251,191,36,0.18)' },
  SPEAKING:     { label: 'Speaking',      Icon: Mic,                    fg: '#031A10', bg: '#D0FFA2' },
  MUTED:        { label: 'Muted',         Icon: VolumeX,                fg: '#F87171', bg: 'rgba(248,113,113,0.15)' },
};

export type ClassroomAiStateBadgeProps = {
  state: AiState;
  /** The engine's reason for the current state. Shown as a tooltip and to screen readers. */
  reason?: string | null;
};

export function ClassroomAiStateBadge({ state, reason }: ClassroomAiStateBadgeProps) {
  const { label, Icon, fg, bg } = PRESENTATION[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm"
      style={{ color: fg, background: bg }}
      title={reason ?? label}
      aria-label={reason ? `SonaAI ${label}: ${reason}` : `SonaAI ${label}`}
    >
      <Icon
        className={`h-3 w-3 ${state === 'UNDERSTANDING' ? 'animate-spin' : ''}`}
      />
      {label}
    </span>
  );
}
