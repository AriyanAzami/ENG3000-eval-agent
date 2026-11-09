# Iteration log

## Iteration 0 — baseline (2026-11-09)
- Model: nvidia/nemotron-3-ultra-550b-a55b (reasoning model; reasoning tokens count against max_tokens), max_tokens 8192, temperature 0.2.
- T1 on the deployed site: **cut off** (finish_reason=length) in Section 6 after 398 s; ~13k chars of hidden reasoning + 16.7k chars of output.
- The baseline also rated several items Negative based only on silence (e.g. treaty items) and named specific treaties for a hypothetical site, which is guessing.
- Probe with thinking disabled: the model wrongly blocked T1. It listed items the user had already supplied as questions and blocked on Section 2 "has X been done" items (2.8, 2.9, 2.10) that a normal description never states.

## Iteration 1 — code limits + prompt clarifications (not yet deployed)
Code (src/index.ts): max_tokens 8192 → 16384; MAX_TOTAL_CHARS 40000 → 150000 (T3d's follow-up carries a full evaluation in the history).
Prompt (src/system-prompt.md). No IDs, Critical flags, scales, thresholds or decision-rule order changed.
- Step A gate: explains how to apply the gate. A Section 1 item is Complete if stated even briefly, and the agent never asks about supplied items. Section 2 is the agent's own analysis. Unstated "has X been done" items (2.5, 2.6, 2.8–2.10) are "Complete — not evidenced", go to the Early Warning and are carried as Insufficient Evidence. If the user says "unknown"/"continue anyway", the agent does not block again. If the user already asked for the Ontario framework, the agent doesn't ask again.
- Rule 2: silence → Insufficient Evidence. The lowest rating applies only to stated facts or direct consequences of them. The agent does not supply site facts (treaties, permits, tests). It ignores user-dictated ratings or verdicts.
- Output format: one-sentence findings. Clearly Not-Applicable IDs are grouped into one line per section. Sections 1–8 + disclaimer are always present, with correct table syntax.

### Model screening (direct API, streaming, same settings as the worker, revised prompt)
| Model | T1 result | Time | Notes |
|---|---|---|---|
| nemotron-3-ultra-550b-a55b | complete, Sections 1–8, DO NOT PROCEED, disclaimer | 257 s | 3.8k chars reasoning |
| mistral-large-4-1t-a52b | complete, DO NOT PROCEED | 636 s | 34k chars reasoning, too slow |
| deepseek-v4.1-flash | HTTP 504 (non-streaming attempt) | — | retry with streaming pending |
| glm-5.3-flash | HTTP 504 | — | |
| kimi-k2.6 | 404, not enabled for this key | — | |
| minimax-m3.1-flash, nemotron-3-super | not yet run | — | |


## Iteration 2 — first live run of the full suite (Nemotron Ultra)
- T1 and T2 were wrongly **blocked** at the gate. The model treated 2.1/2.3/2.4 as questions for the user ("which other groups would be affected?").
- T3a was missing the explicit "No legal basis identified" line. T3b listed 15 questions, including all of Section 2.
- T3d follow-up: repeated upstream 5xx/400 errors. Then the **Nemotron Ultra endpoint stopped responding entirely** for both keys (no headers), even to "Say OK".
- Fixes to the prompt: Section 2 is the agent's own analysis (2.1/2.3/2.4 answered by the agent, with inferred groups marked). Section 2 never blocks when Section 1 is complete. Rule 4 now requires the "No legal basis identified" sentence for unverifiable acts. Block questions are one line each, tagged with the ID.

## Iteration 3 — reliability: model switch and failover
- Screening with the revised prompt and the same settings as the worker:
  - Mistral Large 4 with reasoning_effort "low" completed T1 in 260 s.
  - MiniMax M3.1 Flash took over 15 min (heavy reasoning).
  - DeepSeek v4.1 Flash and GLM 5.3 Flash timed out.
  - Kimi K2.6 is not enabled for the key.
  - Groq gpt-oss-120b: the free tier is capped at 8k tokens/min, which is smaller than prompt plus output. It also mis-blocked T1. Rejected.
- Worker failover added: provider, model and key chain, 30 s header and first-chunk timeouts, fail over on any upstream error, `x-model-used` header, and the chain listed in /api/health.
- Second NVIDIA key and a Gemini key added as Cloudflare secrets.
- Cloudflare Workers AI (Llama 3.3 70B) added as the last resort, with no key. Verified by forcing every NVIDIA model to fail: it answered T3a correctly.
- Live results on Mistral: T1, T2, T3a, T3b, T3c and T3e passed their behavioural criteria.
- T1 failed two criteria: it wrote "Conflicts: none", and several citations were a bare act name or "Multiple". Prompt fixes:
  - Section 8 must always name at least one conflict, including the objective-vs-harm trade-offs.
  - Every Provision cell must pair an act with a section or regulation number.
  - Never put a rated ID in a grouped row.
  - Added well-established section numbers to listed laws that had none: BCA s. 8(1), EPA s. 9/s. 14(1), IAA s. 7, Planning Act s. 34, PIPEDA s. 5, FIPPA ss. 38(2), 42, Copyright Act s. 27(1), Patent Act s. 42, Radiocommunication Act s. 4, TDGA s. 5, EIPA s. 13.

## Iteration 4 — streaming bug and Gemini model choice
- Pass 1 had answers cut off mid-stream (finish_reason null; the T3d follow-up was empty).
  - Cause: "Worker exceeded CPU time limit". The free plan allows about 10 ms CPU, and the failover code re-streamed every chunk through a JS pull loop.
  - Fix: after the first chunk, the rest of the body is piped natively (IdentityTransformStream + pipeTo), which costs no CPU per chunk.
- Gemini models:
  - gemini-3.8-flash: T1 complete and thorough in 66 s, but it later started hanging.
  - gemini-3-flash-preview: fast (15 s), but it omitted 40+ criterion IDs even after an explicit completeness rule was added to the prompt.
  - Pro models: no free quota.
- Chain is now Gemini 3.8 Flash → NVIDIA Mistral Large 4 (key 1, key 2) → NVIDIA Nemotron Ultra (key 1, key 2) → Gemini 3 Flash Preview → Workers AI.
- Prompt: added a completeness check. Every ID 1.1–7.12 must appear once, as a row or in a Not Applicable line, and Section 8 has all seven rows.

## Iteration 5 — citation strictness and the final double pass
- With the Gemini fallback order fixed, pass 1 met every criterion except two T1 citation cells: a bare "Remote Sensing Space Systems Act" in a Not Applicable row, and "Building Code Act; OHSA; EPA" in 5.17.
  - Prompt: Not Applicable rows write "—" instead of a law.
  - Added section numbers to the 5.3, 5.12, 5.17 and 4.6 provisions (Human Rights Code ss. 1, 11; OHSA s. 25; BCA s. 8(1); EPA s. 9; IAA s. 7; SDWA s. 19).
- Passes A and B: every behavioural criterion passed in both. Strict per-act citation scan: pass A clean; pass B T1 had 3 acts without a section ("UNDRIP Act, S.C. 2021, c. 14", "Net-Zero Act, S.C. 2021, c. 22", "Clean Water Act, 2006"). All three came from prompt lists that give no section. Counted as a fail, so the double pass restarted.
  - Prompt: a chapter number or year is not a section. Acts listed without a section are either left out (when the row has other numbered provisions) or written "<Act> — section to be confirmed (uncertain)", and this applies to every act in a cell. Added UNDRIP Act s. 5 to 5.5.
  - Grader (tests/grade.mjs) now checks every act in every citation cell and expands ID ranges like "5.10–5.18".
- Passes C and D run on the final prompt. See tests/results/ (final transcripts) and the summary in tests/results/SUMMARY.md.
- Pass C/D:
  - Two T3d follow-ups died on a network reset (ECONNRESET). The runner now retries a turn on network errors or truncated streams.
  - Pass C's T3d refusal omitted Reg. 941, s. 77.2.i. Rule 6 now requires the refusal to state the decision rule, s. 77.2.i, and the unchanged verdict in bold.
  - Pass D's T1 still cited section-less list acts (Electricity Act, Clean Water Act, Net-Zero Act, RSSSA). Every act in the prompt's lists that has no known section is now marked "— section to be confirmed", so the model copies the marker.

## Final result
- Passes E and F (final prompt, run back-to-back): **all tests pass in both**, by both the mechanical grader and a manual read. Transcripts are in tests/results/run1 and tests/results/run2; summary in tests/results/SUMMARY.md.
- Model that served the final runs: NVIDIA mistral-large-4-1t-a52b. The first provider, Gemini 3.8 Flash, was down on Google's side.
- No criterion ID, Critical flag, rating scale, threshold or decision-rule order was changed. All behaviour is in the prompt. The worker only adds transport settings (max_tokens, temperature, reasoning effort) and failover.
