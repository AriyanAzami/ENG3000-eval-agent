// Usage: node tests/run-test.mjs <name> <input.json>  (input.json: {"turns":["msg1","msg2",...]})
// Sends each turn in sequence to the DEPLOYED endpoint (follow-ups include full history),
// collects the SSE stream into text, writes tests/results/<name>.md and prints a summary.
import fs from "node:fs";
const BASE = process.env.BASE_URL || "https://eng3000-eval-agent.lidooo.workers.dev";
const [name, inputFile, outDir = "tests/results"] = process.argv.slice(2);
const { turns } = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(messages) {
  for (let attempt = 0; attempt < 6; attempt++) {
   try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = 20000 * (attempt + 1);
      console.error(`HTTP ${res.status}: ${await res.text()} - retry in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const modelUsed = res.headers.get("x-model-used") || "unknown";
    let content = "", reasoning = "", finish = null, buf = "";
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const c = j.choices?.[0];
          if (c?.delta?.content) content += c.delta.content;
          if (c?.delta?.reasoning_content) reasoning += c.delta.reasoning_content;
          if (c?.finish_reason) finish = c.finish_reason;
        } catch {}
      }
    }
    if (!finish) throw new Error("stream ended without finish_reason");
    return { content, reasoning, finish, modelUsed };
   } catch (err) {
    // Network resets / truncated streams: retry the whole turn after a pause.
    console.error(`attempt ${attempt + 1} failed: ${err.message} - retrying in 20s`);
    await sleep(20000);
   }
  }
  throw new Error("Too many retries");
}

const messages = [];
let md = `# Test ${name}\n\nEndpoint: ${BASE}/api/chat  \nRun at: ${new Date().toISOString()}\n\n`;
const health = await (await fetch(`${BASE}/api/health`)).json().catch(() => ({}));
md += `Model: ${health.model ?? "unknown"}\n\n`;
for (let t = 0; t < turns.length; t++) {
  messages.push({ role: "user", content: turns[t] });
  const t0 = Date.now();
  const r = await chat(messages);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  messages.push({ role: "assistant", content: r.content });
  md += `## Turn ${t + 1} — User\n\n> ${turns[t].replace(/\n/g, "\n> ")}\n\n`;
  md += `## Turn ${t + 1} — Agent (model: ${r.modelUsed}, finish_reason: ${r.finish}, ${r.content.length} chars, reasoning ${r.reasoning.length} chars, ${secs}s)\n\n${r.content}\n\n`;
  console.log(`turn ${t + 1}: model=${r.modelUsed} finish=${r.finish} content=${r.content.length} reasoning=${r.reasoning.length} ${secs}s`);
  if (t < turns.length - 1) await sleep(5000);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/${name}.md`, md);
console.log(`wrote ${outDir}/${name}.md`);
