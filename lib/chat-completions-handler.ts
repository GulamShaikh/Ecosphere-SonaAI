import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { randomUUID } from 'crypto';
import { processSonaCompletion } from '@/lib/sona/server-engine';

type ChatBody = {
  messages?: Array<{ role: string; content: unknown }>;
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
};

type ChatCompletionsDeps = {
  createOpenAIClient: typeof createOpenAI;
  streamTextImpl: typeof streamText;
};

export function createChatCompletionsHandler({
  createOpenAIClient,
  streamTextImpl,
}: ChatCompletionsDeps) {
  return async function POST(request: NextRequest) {
    let body: ChatBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (process.env.SONA_INTERVENTION_ENGINE === 'true') {
      const expectedSecret = process.env.SONA_LLM_SHARED_SECRET;
      const authorization = request.headers.get('authorization');
      if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const text = await processSonaCompletion({
        channel: typeof body.channel === 'string' ? body.channel : undefined,
        userId: typeof body.userId === 'string' ? body.userId : undefined,
        messages: (body.messages ?? []) as Array<{ role: string; content?: unknown }>,
      });
      return createSonaSseResponse(text, body.model ?? 'sonaai-intervention-engine');
    }

    const apiKey = process.env.NEXT_LLM_API_KEY;
    const llmUrl = process.env.NEXT_LLM_URL;
    const modelId = 'gpt-4o';
    if (!apiKey || !llmUrl) {
      return NextResponse.json(
        { error: 'NEXT_LLM_API_KEY and NEXT_LLM_URL must be set' },
        { status: 500 },
      );
    }

    const baseURL = llmUrl.replace(/\/chat\/completions\/?$/, '');
    const openai = createOpenAIClient({ apiKey, baseURL });
    const result = streamTextImpl({
      model: openai(modelId),
      messages: (body.messages ?? []) as NonNullable<Parameters<typeof streamText>[0]['messages']>,
    });

    const encoder = new TextEncoder();
    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const sseChunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model ?? modelId, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(sseChunk({ role: 'assistant', content: '' }));
          for await (const chunk of result.textStream) controller.enqueue(sseChunk({ content: chunk }));
          controller.enqueue(sseChunk({}, 'stop'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('[custom-llm] Stream error:', error);
          controller.error(error);
        }
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  };
}

function createSonaSseResponse(text: string, model: string): NextResponse {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk({ role: 'assistant', content: '' }));
      if (text) controller.enqueue(chunk({ content: text }));
      controller.enqueue(chunk({}, 'stop'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new NextResponse(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
