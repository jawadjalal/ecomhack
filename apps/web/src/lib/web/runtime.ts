/**
 * The browser side of web personalization: GET /api/web/runtime.js?site=… returns this script with
 * the site's live rules inlined (one request, no extra fetch). darwin.js loads it automatically;
 * adding it synchronously in <head> as well avoids any flicker.
 *
 * Per page view it:
 *   1. works out the visitor's traffic source (first touch per session) and search query (the latest one:
 *      on-site searches update it),
 *   2. for each rule whose audience matches, assigns control/treatment (sticky: same FNV-1a + fmix32
 *      hash of `${visitorId}:${ruleId}` as the server, so the server can recompute it),
 *   3. applies the treatment's changes with textContent / styles only (never innerHTML), hiding the
 *      target elements until they're changed (max 1.5 s) and catching late-rendered elements,
 *   4. sends one `$darwin_web_exposure` event per rule, through darwin.js.
 *
 * Previews: `?darwin_source=ai&darwin_q=trail+shoes&darwin_variant=treatment` force a segment and/or a
 * variant and send no events (used by the console), so a forced variant never pollutes a test.
 */
import type { WebRule, WebRuntimeRule } from "@/lib/contracts";

/** Escape JSON for inlining inside a <script> (no </script>, no line separators). */
function inlineJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function runtimeRules(rules: WebRule[]): WebRuntimeRule[] {
  return rules
    .filter((r) => r.status === "running" || r.status === "shipped")
    .map(({ id, audience, changes, mode, allocation, status }) => ({ id, audience, changes, mode, allocation, status }));
}

/**
 * The runtime for a site. `previewRuleId` adds that rule even if it isn't live yet (a draft the
 * console is previewing); pages opened with ?darwin_preview= are previews and send no events.
 */
export function buildRuntime(site: string, rules: WebRule[], previewRuleId?: string): string {
  const live = runtimeRules(rules);
  const preview = previewRuleId ? rules.find((r) => r.id === previewRuleId && !live.some((l) => l.id === r.id)) : undefined;
  if (preview) live.push(...runtimeRules([{ ...preview, status: "running" }]));
  return `/*! Darwin personalization · site ${site.replace(/[^\w.-]/g, "")} */\n(function(w,d,R,SITE){${RUNTIME_BODY}})(window,document,${inlineJson(live)},${inlineJson(site)});\n`;
}

/**
 * ES5, no dependencies. Readable names on purpose: it's small, and merchants may read it.
 * Exposed as window.darwinWeb = { site, source, query, rules: [{ id, variant, applied }] }.
 */
const RUNTIME_BODY = String.raw`"use strict";
if(w.darwinWeb)return;
var L=location,ss;try{ss=w.sessionStorage}catch(e){}
function param(k){try{return new URL(L.href).searchParams.get(k)}catch(e){return null}}
function host(u){try{return new URL(u).hostname.replace(/^www\./,"").toLowerCase()}catch(e){return""}}
function store(k,v){try{if(v===void 0)return ss&&ss.getItem(k);ss&&ss.setItem(k,v)}catch(e){}}
function hash(s){var h=0x811c9dc5,i;for(i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}
h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return(h>>>0)/4294967296}
function visitorId(){var m=d.cookie.match(/(?:^|; )darwin_id=([^;]+)/),id=m&&decodeURIComponent(m[1]);
try{id=id||w.localStorage.getItem("darwin_id")}catch(e){}
if(!id){id="v_"+(w.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
try{w.localStorage.setItem("darwin_id",id)}catch(e){}
d.cookie="darwin_id="+encodeURIComponent(id)+"; path=/; max-age=31536000; samesite=lax"+(L.protocol=="https:"?"; secure":"")}
return id}
function query(){return(param("utm_term")||param("q")||param("query")||param("s")||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,80)}
function classify(){
var ref=host(d.referrer),self=L.hostname.replace(/^www\./,"").toLowerCase(),
us=(param("utm_source")||"").toLowerCase(),um=(param("utm_medium")||"").toLowerCase(),q=query(),src;
if(ref==self)ref="";
var both=ref+" "+us;
if(/chatgpt|openai|perplexity|claude|anthropic|gemini|copilot|you\.com|phind|mistral|grok|meta\.ai/.test(both))src="ai";
else if(param("gclid")||param("fbclid")||param("msclkid")||param("ttclid")||/^(cpc|ppc|paid|paidsocial|paid_social|display|cpm)$/.test(um))src="paid";
else if(um=="email"||/klaviyo|mailchimp|newsletter|email/.test(us))src="email";
else if(/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage)\./.test(ref+".")||/^(google|bing|duckduckgo|yahoo)$/.test(us)||(!ref&&!us&&param("utm_term")))src="search";
else if(ref=="t.co"||/instagram|facebook|fb\.com|tiktok|twitter|(^|\.)x\.com|linkedin|pinterest|reddit|youtube|threads|snapchat/.test(both)||um=="social")src="social";
else if(ref||us)src="referral";else src="direct";
return{source:src,query:q}}
function segment(){var fs=param("darwin_source"),c=null;
if(fs)return{source:fs,query:(param("darwin_q")||"").toLowerCase(),preview:!0};
var saved=store("darwin_src");if(saved)try{c=JSON.parse(saved)}catch(e){}
if(!c||!c.source){c=classify();store("darwin_src",JSON.stringify(c))}
else{var nq=query();if(nq&&nq!=c.query){c.query=nq;store("darwin_src",JSON.stringify(c))}}
if(param("darwin_variant")||param("darwin_preview"))c.preview=!0;
return c}
function matches(a,seg){a=a||{};
if(a.sources&&a.sources.length&&a.sources.indexOf(seg.source)<0)return!1;
if(a.queryIncludes&&a.queryIncludes.length){var hit=!1;for(var i=0;i<a.queryIncludes.length;i++)if(seg.query&&seg.query.indexOf(String(a.queryIncludes[i]).toLowerCase())>=0)hit=!0;if(!hit)return!1}
if(a.paths&&a.paths.length){var p=!1;for(var j=0;j<a.paths.length;j++)if(L.pathname.indexOf(a.paths[j])==0)p=!0;if(!p)return!1}
return!0}
function title(s){return s.replace(/(^|\s)(\S)/g,function(m,sp,c){return sp+c.toUpperCase()})}
function fill(v,seg){v=String(v==null?"":v);if(v.indexOf("{query}")<0)return v;return seg.query?v.replace(/\{query\}/g,title(seg.query)):null}
function send(ev,p){var dw=w.darwin;if(dw&&dw.capture)dw.capture(ev,p);else(w.darwin=w.darwin||[]).push([ev,p])}
function all(sel){try{return d.querySelectorAll(sel)}catch(e){return[]}}
var BANNER="display:block;box-sizing:border-box;width:100%;margin:0;padding:10px 16px;background:#111;color:#fff;text-align:center;font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.01em;position:relative;z-index:2147483000";
var BADGE="display:inline-block;margin:8px 0 0 8px;padding:3px 9px;border-radius:999px;background:#fef3c7;color:#92400e;font:600 12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;vertical-align:middle";
function applyOne(ruleId,c,seg){var v,i,els,done=0;
if(c.action=="banner"){if(d.querySelector('[data-darwin-banner="'+ruleId+'"]'))return 1;if(!d.body)return 0;
v=fill(c.value,seg);if(v==null)return 1;var b=d.createElement("div");b.setAttribute("data-darwin-banner",ruleId);b.setAttribute("role","note");b.style.cssText=BANNER;b.textContent=v;
d.body.insertBefore(b,d.body.firstChild);return 1}
els=all(c.selector||"");
for(i=0;i<els.length;i++){var el=els[i];if(el.getAttribute("data-darwin-done-"+ruleId))continue;
if(c.action=="text"){v=fill(c.value,seg);if(v!=null)el.textContent=v}
else if(c.action=="hide")el.style.setProperty("display","none","important");
else if(c.action=="style"){if(!/url\(|expression|@import|javascript:/i.test(c.value||""))el.style.cssText+=";"+c.value}
else if(c.action=="badge"){v=fill(c.value,seg);if(v!=null){var s=d.createElement("span");s.setAttribute("data-darwin-badge",ruleId);s.style.cssText=BADGE;s.textContent=v;el.parentNode&&el.parentNode.insertBefore(s,el.nextSibling)}}
el.setAttribute("data-darwin-done-"+ruleId,"1");done++}
return els.length>0}
var seg=segment(),id=visitorId(),out=[],pending=[],forced=param("darwin_variant");
for(var r=0;r<R.length;r++){var rule=R[r];if(!matches(rule.audience,seg))continue;
var variant=rule.status=="shipped"||rule.mode=="always"?"treatment":hash(id+":"+rule.id)<rule.allocation?"treatment":"control";
if(forced=="treatment"||forced=="control")variant=forced;
out.push({id:rule.id,variant:variant,applied:!1});
if(!seg.preview)send("$darwin_web_exposure",{rule_id:rule.id,web_source:seg.source,web_query:seg.query||void 0,darwin_site:SITE});
if(variant=="treatment")for(var k=0;k<rule.changes.length;k++)pending.push({rule:rule.id,change:rule.changes[k],idx:out.length-1})}
w.darwinWeb={site:SITE,source:seg.source,query:seg.query,preview:!!seg.preview,rules:out};
if(!pending.length)return;
var hide=[];for(var h=0;h<pending.length;h++){var pc=pending[h].change;if(pc.selector&&(pc.action=="text"||pc.action=="hide"))hide.push(pc.selector)}
var st=null;if(hide.length){st=d.createElement("style");st.setAttribute("data-darwin-antiflicker","");st.textContent=hide.join(",")+"{visibility:hidden!important}";(d.head||d.documentElement).appendChild(st)}
function unhide(){if(st&&st.parentNode)st.parentNode.removeChild(st);st=null}
function run(){var left=[];for(var i=0;i<pending.length;i++){var p=pending[i];if(applyOne(p.rule,p.change,seg))out[p.idx].applied=!0;else left.push(p)}
pending=left;if(!pending.length){unhide();if(mo)mo.disconnect()}
try{w.dispatchEvent(new CustomEvent("darwin:web",{detail:w.darwinWeb}))}catch(e){}}
var mo=null;
if(w.MutationObserver){mo=new MutationObserver(function(){if(pending.length)run()});mo.observe(d.documentElement,{childList:!0,subtree:!0})}
setTimeout(function(){unhide();if(mo)mo.disconnect()},1500);
if(d.readyState=="loading")d.addEventListener("DOMContentLoaded",run);
run();`;

export { hashToUnit as assignmentHash } from "@/lib/experiments/assign";
