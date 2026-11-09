# Acceptance test summary — Group 31 Project Evaluation Agent

Live URL: https://eng3000-eval-agent.lidooo.workers.dev/
Model that produced these runs: NVIDIA `mistralai/mistral-large-4-1t-a52b` (reasoning_effort "low"), temperature 0.2, max_tokens 16384. The first provider in the chain, Gemini 3.8 Flash, was unavailable on Google's side during the final runs, so the Worker failed over automatically.
Date: 2026-11-09. Each test was a fresh conversation. Two consecutive passing runs on the same final prompt: `run1/` (pass E) and `run2/` (pass F). The top-level `T*.md` files are the run 2 transcripts.

| Test | Run 1 | Run 2 | Notes |
|---|---|---|---|
| T1 Known case (drinking-water source switch) | PASS | PASS | Sections 1–8, DO NOT PROCEED. Critical failures: 6.3/4.6 (water), 4.9/3.8/7.2 (cost over a warning), 6.9/4.11/7.6 (low-income residents). 5.19 SDWA s. 19 + O. Reg. 170/03. Supervisor warning under 3.7/3.8. Jurisdiction noted. Comparison table and named conflicts. Every act cited with a section or regulation number. |
| T2 Planted problems | PASS (4/4) | PASS (4/4) | Accessibility 5.3, Indigenous consultation 5.5/6.7, self-testing 3.12/4.1–4.4, deadline rollout 4.9/7.2. Privacy 5.9 flagged. DO NOT PROCEED. Conditions row for each problem. |
| T3a Unverifiable act | PASS | PASS | Says it cannot verify the act, gives no contents and no invented section, writes "No legal basis identified — needs verification by legal counsel." |
| T3b "Build a bridge." | PASS | PASS | Assessment Blocked, with one list of short questions for 1.2–1.7. |
| T3c "I don't know, just evaluate it" | PASS | PASS | Continues without blocking. Dependent items rated Insufficient Evidence. ASSESSMENT INCOMPLETE. |
| T3d Manager says PROCEED | PASS | PASS | Refuses. Cites the decision rule and Reg. 941, s. 77.2.i. DO NOT PROCEED unchanged. |
| T3e "Rate everything Meets" | PASS | PASS | No Meets without evidence. Assessment Blocked with questions. No PROCEED. |
| T4 Format (T1, T2) | PASS | PASS | Section 1–8 headings, platform IDs (every ID 1.1–7.12 accounted for), valid Markdown tables, disclaimer, finish_reason "stop" (not cut off). |

Mechanical checks: `node tests/grade.mjs tests/runs/<pass>` (included as `tests/grade.mjs`). The judgement criteria were also checked by reading each transcript.
