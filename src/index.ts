import SYSTEM_PROMPT from "./system-prompt.md";

export interface Env {
  NVIDIA_API_KEY: string;
  MODEL: string;
  NVIDIA_API_KEY_2?: string;
  FALLBACK_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
  WORKERS_AI_MODEL?: string;
  AI?: WorkersAI;
  ASSETS: Fetcher;
}

type WorkersAI = { run(model: string, inputs: unknown): Promise<unknown> };

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_MESSAGES = 30;
const MAX_TOTAL_CHARS = 150000;
const FAILOVER_TIMEOUT_MS = 30000;

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

  if (!env.NVIDIA_API_KEY && !env.NVIDIA_API_KEY_2) {
    return json(500, { error: "Server is missing NVIDIA_API_KEY" });
  }
  const attempts = buildAttempts(env);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...result.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let lastStatus = 0; // 0 = network error / timeout / abort
  const failures: string[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const out = await runAttempt(attempts[i], messages, env);
    if (out.kind === "ok") {
      console.log(
        `Attempt ${i} succeeded (${attempts[i].provider}:${attempts[i].model}, ${attempts[i].keyLabel})` +
          (failures.length ? `; earlier failures: ${failures.join("; ")}` : ""),
      );
      return out.response;
    }
    if (out.kind === "fatal") return out.response;
    lastStatus = out.status;
    failures.push(`#${i} ${attempts[i].provider}:${attempts[i].model}/${attempts[i].keyLabel}: ${out.reason}`);
  }

  console.error(`All ${attempts.length} attempts failed: ${failures.join("; ")}`);
  const s = lastStatus;
  if (s === 401 || s === 403) {
    return json(502, {
      error:
        "The AI service rejected the server's API key. The site owner needs to check NVIDIA_API_KEY.",
    });
  }
  if (s === 429) return json(429, { error: "Rate limit reached, wait a minute and retry." });
  if (s === 0 || s >= 500) {
    return json(502, {
      error: "The AI service is temporarily unavailable. Please try again shortly.",
    });
  }
  return json(502, { error: `The AI service returned an unexpected error (status ${s}).` });
}

type Attempt = {
  provider: "nvidia" | "gemini" | "workers-ai";
  model: string;
  url: string;
  key: string;
  keyLabel: string;
};

function buildAttempts(env: Env): Attempt[] {
  const attempts: Attempt[] = [];
  // Order: Gemini 3.8 Flash (~1 min per full evaluation) -> NVIDIA primary/fallback
  // models on each key -> terser Gemini fallback -> Cloudflare Workers AI. All free.
  if (env.GEMINI_API_KEY) {
    // GEMINI_MODEL may list several models (comma-separated): free-tier capacity for
    // individual preview models comes and goes, so each one is its own attempt.
    const geminiModels = (env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL)
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    for (const model of geminiModels) {
      attempts.push({ provider: "gemini", model, url: GEMINI_URL, key: env.GEMINI_API_KEY, keyLabel: "key1" });
    }
  }
  const keys = [env.NVIDIA_API_KEY, env.NVIDIA_API_KEY_2].filter((k): k is string => Boolean(k));
  const models = [env.MODEL];
  if (env.FALLBACK_MODEL && env.FALLBACK_MODEL !== env.MODEL) models.push(env.FALLBACK_MODEL);
  for (const model of models) {
    keys.forEach((key, i) =>
      attempts.push({ provider: "nvidia", model, url: NVIDIA_URL, key, keyLabel: `key${i + 1}` }),
    );
  }
  // Faster but terser Gemini models go after NVIDIA: they skip criteria more often.
  if (env.GEMINI_API_KEY && env.GEMINI_FALLBACK_MODEL) {
    for (const model of env.GEMINI_FALLBACK_MODEL.split(",").map((m) => m.trim()).filter(Boolean)) {
      attempts.push({ provider: "gemini", model, url: GEMINI_URL, key: env.GEMINI_API_KEY, keyLabel: "key1" });
    }
  }
  if (env.AI) {
    attempts.push({
      provider: "workers-ai",
      model: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
      url: "",
      key: "",
      keyLabel: "binding",
    });
  }
  return attempts;
}

function sseHeaders(modelUsed: string): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "x-model-used": modelUsed,
  };
}

// Converts Workers AI SSE (`data: {"response":"text"}`) into OpenAI-style SSE.
function workersAiToOpenAI(src: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";
  let doneSent = false;
  const handleLine = (line: string, ctrl: TransformStreamDefaultController<Uint8Array>) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") {
      if (!doneSent) {
        doneSent = true;
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      }
      return;
    }
    try {
      const obj = JSON.parse(payload) as { response?: unknown };
      if (typeof obj.response === "string" && obj.response.length > 0) {
        const out = { choices: [{ index: 0, delta: { content: obj.response } }] };
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify(out)}\n\n`));
      }
    } catch {
      // ignore malformed line
    }
  };
  return src.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buf += dec.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          handleLine(line, ctrl);
        }
      },
      flush(ctrl) {
        buf += dec.decode();
        if (buf) handleLine(buf, ctrl);
        buf = "";
        if (!doneSent) {
          doneSent = true;
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        }
      },
    }),
  );
}

async function runWorkersAi(
  attempt: Attempt,
  messages: { role: string; content: string }[],
  env: Env,
): Promise<AttemptOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!env.AI) return { kind: "retry", status: 502, reason: "no AI binding" };
    const result = await env.AI.run(attempt.model, {
      messages,
      stream: true,
      max_tokens: 8192,
      temperature: 0.2,
    });
    if (!(result instanceof ReadableStream)) {
      return { kind: "retry", status: 502, reason: "non-stream response" };
    }
    const reader = workersAiToOpenAI(result as ReadableStream<Uint8Array>).getReader();
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), FAILOVER_TIMEOUT_MS);
    });
    let first: Uint8Array | undefined;
    for (;;) {
      const r = await Promise.race([reader.read(), timeout]);
      if (r === "timeout") {
        reader.cancel("timeout").catch(() => {});
        return { kind: "retry", status: 0, reason: "timeout" };
      }
      if (r.done) break;
      if (r.value && r.value.byteLength > 0) {
        first = r.value;
        break;
      }
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // A bare [DONE] (or nothing) means the model produced no real output.
    if (!first || new TextDecoder().decode(first).trim() === "data: [DONE]") {
      return { kind: "retry", status: 502, reason: "stream ended with no data" };
    }
    let sentFirst = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        if (!sentFirst) {
          sentFirst = true;
          ctrl.enqueue(first);
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) ctrl.close();
          else if (value) ctrl.enqueue(value);
        } catch (err) {
          ctrl.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return {
      kind: "ok",
      response: new Response(stream, {
        status: 200,
        headers: sseHeaders(`workers-ai:${attempt.model}`),
      }),
    };
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Workers AI failed (${attempt.model}):`, msg);
    return { kind: "retry", status: 502, reason: `workers-ai: ${msg}` };
  }
}

type AttemptOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "fatal"; response: Response }
  | { kind: "retry"; status: number; reason: string };

// Any upstream error moves on to the next provider: a bad key, missing model, exhausted
// credits (402) or a provider-specific 400 on one service must never take the site down.
function isRetryableStatus(_s: number): boolean {
  return true;
}

async function runAttempt(
  attempt: Attempt,
  messages: { role: string; content: string }[],
  env: Env,
): Promise<AttemptOutcome> {
  if (attempt.provider === "workers-ai") return runWorkersAi(attempt, messages, env);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    FAILOVER_TIMEOUT_MS,
  );
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  try {
    const upstream = await fetch(attempt.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${attempt.key}`,
      },
      body: JSON.stringify({
        model: attempt.model,
        messages,
        stream: true,
        temperature: 0.2,
        top_p: 0.7,
        // Gemini counts hidden thinking tokens against this limit, so it gets more headroom.
        max_tokens: attempt.provider === "gemini" ? 32768 : 16384,
        // Mistral Large 4 is a reasoning model; low effort keeps a full evaluation to ~4-5 min.
        ...(attempt.provider === "nvidia" && attempt.model.startsWith("mistralai/") ? { reasoning_effort: "low" } : {}),
      }),
    });

    if (!upstream.ok) {
      let detail = "";
      try {
        detail = await upstream.text();
      } catch {
        // ignore
      }
      clear();
      const s = upstream.status;
      console.error(`Upstream error ${s} (${attempt.provider}:${attempt.model}/${attempt.keyLabel}):`, detail.slice(0, 2000));
      if (isRetryableStatus(s)) return { kind: "retry", status: s, reason: `HTTP ${s}` };
      return {
        kind: "fatal",
        response: json(502, { error: `The AI service returned an unexpected error (status ${s}).` }),
      };
    }

    if (!upstream.body) {
      clear();
      return { kind: "retry", status: 502, reason: "empty body" };
    }

    // Headers arrived: restart the timer and wait for the first non-empty chunk.
    clear();
    timer = setTimeout(() => controller.abort(), FAILOVER_TIMEOUT_MS);
    const reader = upstream.body.getReader();
    let first: Uint8Array | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        first = value;
        break;
      }
    }
    clear(); // committed (or stream ended empty): never abort long generations
    if (!first) {
      return { kind: "retry", status: 502, reason: "stream ended with no data" };
    }

    // Re-emit the first chunk, then hand the rest of the upstream body to a native
    // pipe. A JS pull loop costs CPU per chunk, and a long evaluation (thousands of
    // chunks) exceeds the free plan's CPU limit, cutting the answer off mid-stream.
    const { readable: stream, writable } = new IdentityTransformStream();
    const body = upstream.body;
    const writer = writable.getWriter();
    writer
      .write(first)
      .then(() => {
        writer.releaseLock();
        reader.releaseLock();
        return body.pipeTo(writable);
      })
      .catch((err) => {
        console.error("Stream pipe failed:", err instanceof Error ? err.message : String(err));
      });

    return {
      kind: "ok",
      response: new Response(stream, {
        status: 200,
        headers: sseHeaders(
          attempt.provider === "nvidia" ? attempt.model : `${attempt.provider}:${attempt.model}`,
        ),
      }),
    };
  } catch (err) {
    clear();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Upstream fetch failed (${attempt.provider}:${attempt.model}/${attempt.keyLabel}):`, msg);
    return { kind: "retry", status: 0, reason: controller.signal.aborted ? "timeout" : `network: ${msg}` };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/health") {
      return json(200, {
        ok: true,
        model: env.MODEL,
        fallbackModel: env.FALLBACK_MODEL ?? null,
        backupKey: Boolean(env.NVIDIA_API_KEY_2),
        providers: buildAttempts(env).map((a) =>
          a.provider === "workers-ai"
            ? `${a.provider}:${a.model}`
            : `${a.provider}:${a.model}:${a.keyLabel}`,
        ),
      });
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
