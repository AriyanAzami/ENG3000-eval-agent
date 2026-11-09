# Group 31 Project Evaluation Agent

A free AI chat agent built by Group 31 for ENG 3000 (Professional Engineering Practice) at York University. Describe a proposed engineering project in Ontario and the agent evaluates it on:

- Q1: professional obligations
- Q2: legal compliance
- Q3: benefit to the land
- Risk
- Ethics
- A final verdict

## Live link

https://eng3000-eval-agent.lidooo.workers.dev

## Stack

- Cloudflare Workers + Static Assets (frontend in `public/`, API in `src/index.ts`)
- Free AI providers with automatic failover (all OpenAI-style streaming), tried in this order:
  1. Google Gemini `gemini-3.8-flash` (`GEMINI_MODEL`, secret `GEMINI_API_KEY`)
  2. NVIDIA `mistralai/mistral-large-4-1t-a52b` (`MODEL`) on `NVIDIA_API_KEY`, then `NVIDIA_API_KEY_2`
  3. NVIDIA `nvidia/nemotron-3-ultra-550b-a55b` (`FALLBACK_MODEL`) on both keys
  4. Google Gemini `gemini-3-flash-preview` (`GEMINI_FALLBACK_MODEL`)
  5. Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (`WORKERS_AI_MODEL`, no key needed)

  A provider is skipped if it returns any error or sends nothing within 30 s. The response header `x-model-used` and `GET /api/health` show which model answered and the full chain.
- [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) for rendering Markdown safely in the browser

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # then put your key from build.nvidia.com in .dev.vars
npx wrangler dev
```

Open http://localhost:8787.

## Deploy

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put NVIDIA_API_KEY
npx wrangler secret put NVIDIA_API_KEY_2   # optional backup key
npx wrangler secret put GEMINI_API_KEY     # optional, free-tier key from aistudio.google.com (no billing)
```

Note: `account_id` is pinned in `wrangler.jsonc`. Change it if you deploy to another Cloudflare account.

## Update the prompt

Edit `src/system-prompt.md` and redeploy with `npx wrangler deploy`.

## Change model

Edit `MODEL`, `FALLBACK_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` or `WORKERS_AI_MODEL` in `wrangler.jsonc` and redeploy.

## Reproduce in any free chatbot

Copy the contents of `src/system-prompt.md`, or the text shown by the "View system prompt" button in the app, and paste it as custom instructions or as the first message in any chatbot.

## API endpoints

- `GET /api/health`: returns `{ "ok": true, "model": "...", "providers": [...] }` (never the keys)
- `GET /api/prompt`: returns the system prompt as plain text
- `POST /api/chat`: body `{ "messages": [{ "role": "user" | "assistant", "content": "..." }] }`; streams an OpenAI-style server-sent event response

## Cost

Free for everyone: Cloudflare free plan, NVIDIA free tier (about 40 requests per minute per key), Gemini free tier (no billing account linked, so it can never charge), and Workers AI's free daily allowance. No card is attached to any of them.

## Tests

`tests/inputs/` holds the acceptance tests, `tests/run-test.mjs` runs one against the deployed site, `tests/run-parallel.sh <dir>` runs the suite, and `tests/grade.mjs <dir>` applies the mechanical pass criteria. Final transcripts are in `tests/results/` (two consecutive passing runs in `run1/` and `run2/`), the summary is in `tests/results/SUMMARY.md`, and the iteration log is in `tests/ITERATIONS.md`.

## Disclaimer

Educational tool for ENG 3000. Not legal or professional engineering advice.
