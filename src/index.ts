import SYSTEM_PROMPT from "./system-prompt.md";

export interface Env {
  NVIDIA_API_KEY: string;
  MODEL: string;
  ASSETS: Fetcher;
}

const UPSTREAM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MAX_MESSAGES = 30;
const MAX_TOTAL_CHARS = 40000;

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type Validation =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; status: number; error: string };

function validateMessages(body: unknown): Validation {
  const fail = (status: number, error: string): Validation => ({ ok: false, status, error });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, 'Request body must be a JSON object like {"messages": [...]}.');
  }
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return fail(400, '"messages" must be an array.');
  if (raw.length < 1) return fail(400, '"messages" must contain at least one message.');
  if (raw.length > MAX_MESSAGES) {
    return fail(400, `"messages" may contain at most ${MAX_MESSAGES} messages.`);
  }
  const messages: ChatMessage[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as { role?: unknown; content?: unknown } | null;
    if (typeof m !== "object" || m === null) {
      return fail(400, `messages[${i}] must be an object.`);
    }
    if (m.role !== "user" && m.role !== "assistant") {
      return fail(400, `messages[${i}].role must be "user" or "assistant".`);
    }
    if (typeof m.content !== "string" || m.content.length === 0) {
      return fail(400, `messages[${i}].content must be a non-empty string.`);
    }
    total += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (total > MAX_TOTAL_CHARS) {
    return fail(
      413,
      `Conversation is too long (limit ${MAX_TOTAL_CHARS} characters). Start a new evaluation.`,
    );
  }
  if (messages[messages.length - 1].role !== "user") {
    return fail(400, 'The last message must have role "user".');
  }
  return { ok: true, messages };
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  const origin = request.headers.get("Origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== new URL(request.url).host) {
      return json(403, { error: "Cross-origin requests are not allowed." });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  const result = validateMessages(body);
  if (!result.ok) return json(result.status, { error: result.error });

  if (!env.NVIDIA_API_KEY) {
    return json(500, { error: "Server is missing NVIDIA_API_KEY" });
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...result.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 4096,
      }),
    });
  } catch (err) {
    console.error("Upstream fetch failed:", err instanceof Error ? err.message : String(err));
    return json(502, { error: "Could not reach the AI service. Please try again shortly." });
  }

  if (!upstream.ok) {
    let detail = "";
    try {
      detail = await upstream.text();
    } catch {
      // ignore
    }
    console.error(`Upstream error ${upstream.status}:`, detail.slice(0, 2000));
    const s = upstream.status;
    if (s === 401 || s === 403) {
      return json(502, {
        error:
          "The AI service rejected the server's API key. The site owner needs to check NVIDIA_API_KEY.",
      });
    }
    if (s === 429) return json(429, { error: "Rate limit reached, wait a minute and retry." });
    if (s >= 500) {
      return json(502, {
        error: "The AI service is temporarily unavailable. Please try again shortly.",
      });
    }
    return json(502, { error: `The AI service returned an unexpected error (status ${s}).` });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/health") {
      return json(200, { ok: true, model: env.MODEL });
    }
    if (path === "/api/prompt") {
      return new Response(SYSTEM_PROMPT, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/api/chat") {
      return handleChat(request, env);
    }
    if (path.startsWith("/api/")) {
      return json(404, { error: "Not found." });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
