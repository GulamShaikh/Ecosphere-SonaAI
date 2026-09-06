# SonaAI Classroom

<p align="center">
   <img src="./public/SonaAI%20icon1.png" width="128" alt="SonaAI logo" />
</p>

<p align="center">
   <strong>The AI co-teacher that knows when to speak.</strong><br />
   A live classroom built with Next.js, Agora Conversational AI, and Supabase.
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

SonaAI joins a live classroom as an AI participant, follows the lesson, detects learning gaps, and asks the teacher before offering help. Teachers and students join the same Agora room with named participant tiles, live transcript, intervention signals, and post-class learning support.

![SonaAI classroom logo](./public/SonaAI%20icon1.png)

## Highlights

- Live teacher and student voice classroom through Agora RTC.
- Agora Conversational AI participant with STT, LLM, TTS, transcript, and latency events.
- Teacher-controlled `AUTO`, `ASK`, and `MUTE` modes.
- Deterministic `SPEAK`, `WAIT`, `ASK`, and `MUTE` intervention policy.
- Named teacher/student presence tiles and invite links.
- Intervention card with evidence and **Allow** / **Not now** actions.
- Teacher post-class summary with PDF download.
- Student post-class exercise based on the lesson context.
- Supabase authentication and profile support.

## Prerequisites

- [Node.js 22+](https://nodejs.org/en/download/)
- [pnpm](https://pnpm.io/installation)
- An Agora project with Conversational AI enabled.
- A Supabase project for authentication.

## Run Locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in as a teacher, start a class, then use **Invite students** to share the classroom link.

For a live custom intervention engine, Agora Cloud must reach the application through public HTTPS. Use a deployed URL or a tunnel during local rehearsal.

## Environment

Copy `env.local.example` to `.env.local` and fill in the values:

```env
NEXT_PUBLIC_AGORA_APP_ID=...
NEXT_AGORA_APP_CERTIFICATE=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Required for strict teacher approval through the custom intervention engine
SONA_INTERVENTION_ENGINE=true
SONA_PUBLIC_BASE_URL=https://your-public-domain.example
SONA_LLM_SHARED_SECRET=...
SONA_AI_MODE=ASK
NEXT_DEEPGRAM_LANGUAGE=en-US
NEXT_LLM_URL=https://api.openai.com/v1/chat/completions
NEXT_LLM_API_KEY=...
NEXT_LLM_MODEL=gpt-4o-mini
```

Keep `.env.local` private. Never expose the Agora App Certificate or LLM keys in client code.

## Deploy

Railway or Render is recommended for the complete app because the custom intervention engine keeps short-lived classroom state server-side and Agora requires a stable public HTTPS endpoint. Vercel can host the Next.js UI, but a persistent Node host is preferable for the strict intervention path.

Set the same environment variables in the hosting provider dashboard and set `SONA_PUBLIC_BASE_URL` to the deployed URL.

## Verification

```bash
pnpm run doctor
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run verify:api
pnpm run build
pnpm run verify
```

The project currently verifies with 23 intervention-policy tests, API contract checks, and a successful production build. Lint emits non-blocking warnings from existing UI code.

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./system-architecture-dark.svg">
  <img src="./system-architecture.svg" alt="System architecture">
</picture>

The browser fetches a combined RTC + RTM token (`buildTokenWithRtm`) from this app, joins the channel using a single RTC client, and uses RTM as the data channel for transcript, agent state, metrics, and error events. The Conversational AI Engine joins the same channel as the shared agent UID in [`lib/agora.ts`](lib/agora.ts) and runs the STT → LLM → TTS pipeline in Agora Cloud.

## What You Get

- browser voice client built with Next.js App Router
- RTC audio plus RTM transcript and state events
- server routes for token generation, invite, and stop
- optional custom SonaAI intervention engine with WAIT / ASK / SPEAK / MUTE policy
- RTM participant presence with named teacher/student tiles and one-click invite links
- [`AgentVisualizer`](https://agoraio-conversational-ai.github.io/agent-uikit/) for agent state and a built-in transcript panel for live turns
- per-stage latency header driven by `AGENT_METRICS`
- Agora-managed default STT, LLM, and TTS configuration

## How It Works

1. The browser requests an RTC + RTM token from `/api/generate-agora-token`.
2. The backend invites an Agora cloud agent with `/api/invite-agent`.
3. The browser joins the channel and publishes mic audio.
4. The client receives transcript, agent state, and `AGENT_METRICS` (per-stage latency) events over RTM.
5. On end, the client calls `/api/stop-conversation`, logs out RTM, and unmounts the call view so Agora React hooks clean up RTC publish/join and the local microphone track.

## Optional BYOK

The default path uses Agora-managed STT, LLM, and TTS. If you need provider-owned credentials, uncomment the matching snippet in [`app/api/invite-agent/route.ts`](app/api/invite-agent/route.ts) and add its variables to your local environment.

```bash
# Deepgram STT
NEXT_DEEPGRAM_API_KEY=...

# OpenAI-compatible LLM
NEXT_LLM_URL=https://api.openai.com/v1/chat/completions
NEXT_LLM_API_KEY=...

# ElevenLabs TTS
NEXT_ELEVENLABS_API_KEY=...
NEXT_ELEVENLABS_VOICE_ID=...
```

## Repo Map

- `app/api/generate-agora-token/route.ts` — issues RTC + RTM tokens
- `app/api/invite-agent/route.ts` — starts the agent session and configures the pipeline
- `app/api/stop-conversation/route.ts` — stops the agent session
- `components/MeetingPage.tsx` — meeting entry point: token fetch, RTM login, conversation lifecycle
- `components/ConversationComponent.tsx` — RTC client, transcript state, `AGENT_METRICS`, mic release
- `components/ClassroomConversationLayout.tsx` — in-call header, transcript rail, controls dock
- `components/ClassroomPipelineMetrics.tsx` — per-stage latency chips in the header
- `components/ClassroomTranscriptPanel.tsx` — live transcript rail
- `lib/conversation.ts` — transcript normalization and visualizer state mapping
- `AGENTS.md` — primary agent-facing guide

## Troubleshooting

- **Agent does not join or transcripts are missing:** run `agora project doctor --deep`.
- **`pnpm run doctor` fails:** run `agora project env write .env.local`, then retry.
- **Manual clone / env values:** `agora project use <your-project>` then `agora project env write .env.local`.
- **RTM login fails:** keep [`app/api/generate-agora-token/route.ts`](app/api/generate-agora-token/route.ts) on `RtcTokenBuilder.buildTokenWithRtm` — RTC-only tokens will not satisfy `rtm.login`.
- **Transcript speakers inverted:** check the `uid === "0"` remap in [`components/ConversationComponent.tsx`](components/ConversationComponent.tsx).
- **Agent never appears in channel:** ensure the shared agent UID in [`lib/agora.ts`](lib/agora.ts) is used by both the client and invite route.

## More Docs

- [docs/ai/L0_repo_card.md](./docs/ai/L0_repo_card.md)
- [docs/ai/RECIPE.md](./docs/ai/RECIPE.md)
- [AGENTS.md](./AGENTS.md)

## Contributing

Pull requests welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and conventions.

## Security

Please do **not** open public issues for security reports. Email security@agora.io with details and reproduction steps.

## License

Released under the [MIT License](./LICENSE).
