# Cooksy — kitchen agent console (`living-ai-talk`)

A voice and chat console for a kitchen, built on **OpenClaw**: Cook reads what you have, Planner proposes what to change, and every write waits for your approval.

> **Doha:** Read **[`ASSIGNMENT.md`](./ASSIGNMENT.md)** for your assignment brief — what to build, what to keep, what to replace, and the voice library recommendations. The original brief given to other candidates is in `ORIGINAL-ASSIGNMENT/` for reference only.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template and configure your OpenClaw Gateway URL
cp .env.example .env

# Verify types, tests, and production build
npm run typecheck
npm test
npm run build

# Start development server
npm run dev
```

## Key Scripts

- `npm run dev` — Start the Vite + TanStack Start dev server
- `npm run build` — Build client, SSR, and Nitro server bundles
- `npm run typecheck` — Run TypeScript compiler checks (`tsc --noEmit`)
- `npm test` — Run the unit test suite (`node --test`)
- `npm run lint` — Run ESLint

## Architecture Reference

- **`ASSIGNMENT.md`** — Candidate challenge brief, requirements, and grading rubric
- **`src/routes/index.tsx`** — Main voice/chat console and run lifecycle controller
- **`src/styles.css`** — Cooksy design tokens: ember palette, glass, radii, motion
- **`src/lib/three/ember-field.ts`** — Optional WebGL haze and mic ring (lazy chunk, disposed on unmount)
- **`src/routes/api/agent.ts`** — Server route connecting the console to your OpenClaw Gateway
- **`src/routes/api/transcribe.ts`** — Server route for speech to text (`STT_BASE_URL`; the key never reaches the browser)
- **`src/lib/settings/voice.ts`** — OpenClaw agent roster (`AGENTS`) and voice/ASR settings
- **`src/lib/voice/screen.ts`** — Structured screen, voice command (`app_commands`), and `action_proposal` parser
