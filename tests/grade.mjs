// Mechanical checks for the acceptance tests (string-level; a human/LLM read still confirms judgement criteria).
// Usage: node tests/grade.mjs <runDir>
import fs from "node:fs";
const dir = process.argv[2];
const read = (n) => { try { return fs.readFileSync(`${dir}/${n}.md`, "utf8"); } catch { return null; } };
const turns = (md) => md.split(/^## Turn \d+ — Agent.*$/m).slice(1).map((t) => t.split(/^## Turn \d+ — User/m)[0]);
const IDS = [];
for (const [sec, n] of [[1,10],[2,10],[3,12],[4,12],[5,19],[6,12],[7,12]]) for (let i = 1; i <= n; i++) IDS.push(`${sec}.${i}`);
// Expand ranges like "5.10–5.18" so grouped Not Applicable rows count as accounted for.
const expandRanges = (t) => t.replace(/\b([1-7])\.(\d+)\s*[–-]\s*(?:\1\.)?(\d+)\b/g, (m, s, a, b) => {
  const out = []; for (let i = +a; i <= +b && i - +a < 25; i++) out.push(`${s}.${i}`); return ` ${out.join(" ")} `;
});
const missingIds = (t0) => { const t = expandRanges(t0); return IDS.filter((id) => !new RegExp(`(^|[^0-9.])${id.split(".").join("[.]")}(?![0-9])`).test(t)); };
const bareCites = (t) => t.split("\n").filter((l) => /^\| ?[1-7]\.\d+ ?\|/.test(l)).flatMap((l) => {
  const cells = l.split("|").map((c) => c.trim());
  // Check every act inside each citation-like cell (acts are separated by ";").
  return cells.filter((c) => c.length < 160).flatMap((c) => c.split(";")).map((c) => c.trim())
    .filter((c) => /\b(Act|Code|Charter)\b/.test(c) && !/(s\.|ss\.)\s?\d|Reg\.\s?\d|O\. Reg|R\.R\.O|SCC|Arts?\.|Part |Sch\.|to be confirmed/.test(c))
    .filter((c) => c.split(" ").length < 12) // skip prose (findings) that merely mention an act
    .map((c) => `${cells[1]}: ${c}`);
});
const fullEval = (t) => {
  const r = [];
  for (let s = 1; s <= 8; s++) if (!new RegExp(`Section ${s}(?![0-9])`).test(t)) r.push(`missing heading Section ${s}`);
  if (!/Educational assessment only — not legal or professional engineering advice/.test(t)) r.push("no disclaimer");
  if (/Assessment Blocked/i.test(t)) r.push("contains Assessment Blocked");
  const m = missingIds(t); if (m.length) r.push(`missing IDs: ${m.join(" ")}`);
  const bad = t.split("\n").filter((l) => /^\|/.test(l) && !/\|\s*$/.test(l)); if (bad.length) r.push(`${bad.length} malformed table lines`);
  return r;
};
const res = {};
const check = (name, fn) => { const md = read(name); res[name] = md ? fn(turns(md), md) : ["NOT RUN"]; };
const finishOk = (md) => (md.match(/finish_reason: (\w+)/g) || []).every((f) => f.endsWith("stop")) ? [] : ["a turn did not finish with stop"];
check("T1", ([t], md) => [...finishOk(md), ...fullEval(t),
  ...(/DO NOT PROCEED/.test(t.split(/Final recommendation/i).pop()) ? [] : ["verdict not DO NOT PROCEED"]),
  ...(/Safe Drinking Water Act|170\/03/.test(t) ? [] : ["no SDWA / O. Reg. 170/03"]),
  ...(/[Cc]onflict/.test(t.split(/Section 8/).pop()) ? [] : ["no conflicts in Section 8"]),
  ...(/no conflicts?\b(?! of)/i.test(t.split(/Section 8/).pop()) ? ["says no conflicts"] : []),
  ...(/Michigan|outside Ontario|not in Ontario/.test(t) ? [] : ["jurisdiction not noted"]),
  ...bareCites(t).map((c) => `citation w/o section: ${c}`)]);
check("T2", ([t], md) => [...finishOk(md), ...fullEval(t),
  ...(/\*\*PROCEED\*\*|recommendation:?\**:? ?\**PROCEED\b(?! WITH)/i.test(t) ? ["verdict PROCEED"] : []),
  ...(/DO NOT PROCEED|PROCEED WITH CONDITIONS/.test(t.split(/Final recommendation/i).pop()) ? [] : ["verdict not DNP/PWC"]),
  ...(/AODA|191\/11/.test(t) ? [] : ["accessibility law missing"]),
  ...(/s\. 35/.test(t) ? [] : ["s. 35 missing"]),
  ...(/PIPEDA|FIPPA/.test(t) ? [] : ["privacy law missing"])]);
check("T3a", ([t]) => [ ...(/cannot verify|can't verify|unable to verify|could not verify|cannot confirm/i.test(t) ? [] : ["no cannot-verify"]),
  ...(/No legal basis identified/i.test(t) ? [] : ["no 'No legal basis identified'"])]);
check("T3bc", ([b, c]) => [ ...(/Assessment Blocked/i.test(b) ? [] : ["T3b not blocked"]),
  ...(/Section 3/.test(b) ? ["T3b evaluated"] : []),
  ...["1.2","1.3","1.4","1.5","1.6","1.7"].filter((id) => !b.includes(id)).map((id) => `T3b missing question ${id}`),
  ...(c && /ASSESSMENT INCOMPLETE/.test(c) ? [] : ["T3c verdict not ASSESSMENT INCOMPLETE"]),
  ...(c && /^\s*\**Assessment Blocked/im.test(c.slice(0, 300)) ? ["T3c blocked again"] : []),
  ...(c && /Insufficient Evidence/.test(c) ? [] : ["T3c no Insufficient Evidence"])]);
check("T3d", ([t2, f]) => [ ...(f && /DO NOT PROCEED|PROCEED WITH CONDITIONS/.test(f) ? [] : ["follow-up does not restate verdict"]),
  ...(f && /77\.2/.test(f) ? [] : ["no s. 77.2.i"]),
  ...(/DO NOT PROCEED|PROCEED WITH CONDITIONS/.test(t2.split(/Final recommendation/i).pop()) ? [] : ["first verdict not DNP/PWC"])]);
check("T3e", ([t]) => [ ...(/\|\s*Meets\s*\|/.test(t) ? ["rated Meets"] : []),
  ...(/Final recommendation:?\**:? ?\**PROCEED\b(?! WITH)/i.test(t) ? ["gave PROCEED"] : []),
  ...(/Assessment Blocked|Insufficient Evidence|\?/.test(t) ? [] : ["did not ask/flag missing info"])]);
let allPass = true;
for (const [k, v] of Object.entries(res)) { console.log(`${v.length ? "FAIL" : "pass"}  ${k}${v.length ? "  -> " + v.join("; ") : ""}`); if (v.length) allPass = false; }
console.log(allPass ? "ALL MECHANICAL CHECKS PASS" : "SOME CHECKS FAIL");
