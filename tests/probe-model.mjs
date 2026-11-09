// Direct NVIDIA streaming call (model screening only): node tests/probe-model.mjs <model> <testName> [extraJSON]
import fs from "node:fs";
const key = fs.readFileSync(".dev.vars","utf8").match(/NVIDIA_API_KEY=(.*)/)[1].trim().replace(/"/g,"");
const [model, test, extra="{}"] = process.argv.slice(2);
const sys = fs.readFileSync("src/system-prompt.md","utf8");
const { turns } = JSON.parse(fs.readFileSync(`tests/inputs/${test}.json`,"utf8"));
const t0=Date.now();
const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",accept:"text/event-stream",authorization:`Bearer ${key}`},
 body:JSON.stringify({model,messages:[{role:"system",content:sys},{role:"user",content:turns[0]}],temperature:0.2,top_p:0.7,max_tokens:16384,stream:true,...JSON.parse(extra)})});
if(!res.ok){console.log(model,test,"HTTP",res.status,(await res.text()).slice(0,200));process.exit()}
let out="",reas="",fin=null,buf="";const dec=new TextDecoder();
for await (const ch of res.body){buf+=dec.decode(ch,{stream:true});let i;while((i=buf.indexOf("\n"))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l.startsWith("data:"))continue;const d=l.slice(5).trim();if(d==="[DONE]")continue;try{const c=JSON.parse(d).choices?.[0];if(c?.delta?.content)out+=c.delta.content;const r=c?.delta?.reasoning_content||c?.delta?.reasoning;if(r)reas+=r;if(c?.finish_reason)fin=c.finish_reason}catch{}}}
const safe=model.replace(/\//g,"_");
fs.writeFileSync(`tests/runs/probe-${safe}-${test}.md`,out);
console.log(model,test,`finish=${fin} chars=${out.length} reasoning=${reas.length} ${((Date.now()-t0)/1000).toFixed(0)}s blocked=${/Assessment Blocked/i.test(out)} sec8=${/Section 8/.test(out)} disclaimer=${/Educational assessment only/.test(out)} DNP=${/DO NOT PROCEED/.test(out)}`);
