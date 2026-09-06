import { NextResponse } from 'next/server';
import { setSonaMode } from '@/lib/sona/server-engine';
import type { AiMode } from '@/lib/sona/types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { channel?: unknown; mode?: unknown };
    const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
    const mode = body.mode;

    if (!channel || (mode !== 'AUTO' && mode !== 'ASK' && mode !== 'MUTE')) {
      return NextResponse.json(
        { error: 'channel and mode (AUTO, ASK, or MUTE) are required' },
        { status: 400 },
      );
    }

    setSonaMode(channel, mode as AiMode);
    return NextResponse.json({ success: true, channel, mode });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}