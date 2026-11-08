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
- NVIDIA API free tier (OpenAI-compatible chat completions, streaming)
- Model `nvidia/nemotron-3-ultra-550b-a55b`, set by the `MODEL` var in `wrangler.jsonc`
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
```

Note: `account_id` is pinned in `wrangler.jsonc`. Change it if you deploy to another Cloudflare account.

## Update the prompt

Edit `src/system-prompt.md` and redeploy with `npx wrangler deploy`.

## Change model

Edit `MODEL` in `wrangler.jsonc` and redeploy.

## Reproduce in any free chatbot

Copy the contents of `src/system-prompt.md`, or the text shown by the "View system prompt" button in the app, and paste it as custom instructions or as the first message in any chatbot.

## API endpoints

- `GET /api/health`: returns `{ "ok": true, "model": "..." }`
- `GET /api/prompt`: returns the system prompt as plain text
- `POST /api/chat`: body `{ "messages": [{ "role": "user" | "assistant", "content": "..." }] }`; streams an OpenAI-style server-sent event response

## Cost

Runs on the Cloudflare free plan only. The NVIDIA free tier allows roughly 40 requests per minute. The Worker does not retry failed upstream requests.

## Disclaimer

Educational tool for ENG 3000. Not legal or professional engineering advice.
