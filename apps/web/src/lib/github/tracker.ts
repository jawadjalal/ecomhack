/**
 * Source of `GET /darwin.js` — the tag Darwin's install PR adds to a merchant's storefront.
 *
 * Tiny (< 4 KB, hand-minified), dependency-free, ES5. Posts batches of PostHog-shaped events
 * to `{script origin}/api/collect`:
 *   - `$pageview` on load and client-side navigations (pushState / popstate)
 *   - `$pageleave` on client-side navigation away (for the previous path) and on tab close
 *   - `$autocapture` for clicks (tag, visible text ≤ 64 chars, short CSS selector, href)
 *   - `$rageclick` when the same element is clicked 3 times within 1 s
 *   - `window.darwin.capture(event, props)` for custom commerce events
 *     (calls queued before load via `window.darwin = [[event, props]]` are replayed)
 *
 * Privacy: never reads input values; random first-party id only (`darwin_id` cookie +
 * localStorage); honours GPC / Do Not Track (override with `data-darwin-respect-dnt="false"`).
 * Batches go out as `text/plain` so cross-origin posts need no CORS preflight, and via
 * `sendBeacon` when the page is hidden.
 *
 * <script> attributes: `data-darwin-site` (site id), `data-darwin-endpoint` (collect URL override).
 *
 * Readable names: w=window d=document n=navigator L=location s=script tag, q=queue,
 * T=flush timer, P=current path, H=current href, X=last clicked element, C=click times.
 */
export const TRACKER_JS = `/*! Darwin analytics */
(function(w,d){"use strict";
if(w.darwin&&w.darwin.v)return;
var n=navigator,L=location,s=d.currentScript||d.querySelector('script[src*="/darwin.js"]'),
at=function(k){return s?s.getAttribute(k):null},
url=at("data-darwin-endpoint")||(s&&s.src?new URL(s.src,L.href).origin:L.origin)+"/api/collect",
site=at("data-darwin-site")||"",pre=Array.isArray(w.darwin)?w.darwin:[],noop=function(){};
if((n.globalPrivacyControl||n.doNotTrack=="1")&&at("data-darwin-respect-dnt")!="false"){w.darwin={v:1,capture:noop,flush:noop,optedOut:!0};return}
function rid(){try{return crypto.randomUUID()}catch(e){return Date.now().toString(36)+Math.random().toString(36).slice(2)}}
function kv(t,k,v){try{if(v===void 0)return w[t].getItem(k);w[t].setItem(k,v)}catch(e){}}
var m=d.cookie.match(/(?:^|; )darwin_id=([^;]+)/),
id=(m&&decodeURIComponent(m[1]))||kv("localStorage","darwin_id")||"v_"+rid(),
sid=kv("sessionStorage","darwin_sid")||"s_"+rid(),ua=n.userAgent,
dev=/iPad|Tablet/i.test(ua)?"Tablet":/Mobi|Android/i.test(ua)?"Mobile":"Desktop",
q=[],T=0,P=L.pathname,H=L.href,left=0,X,C=[];
kv("localStorage","darwin_id",id);kv("sessionStorage","darwin_sid",sid);
d.cookie="darwin_id="+encodeURIComponent(id)+"; path=/; max-age=31536000; samesite=lax"+(L.protocol=="https:"?"; secure":"");
function capture(ev,props){if(!ev)return;
var p={$current_url:L.href,$pathname:L.pathname,$referrer:d.referrer||void 0,$session_id:sid,$device_type:dev,$lib:"darwin-js",darwin_site:site};
if(n.webdriver)p.$webdriver=!0;
for(var k in props)p[k]=props[k];
q.push({event:String(ev),distinct_id:id,timestamp:new Date().toISOString(),properties:p});
if(q.length>=20)flush();else if(!T)T=setTimeout(flush,1e3)}
function flush(beacon){clearTimeout(T);T=0;
while(q.length){var b=JSON.stringify({events:q.splice(0,50)});
if(beacon===!0&&n.sendBeacon&&n.sendBeacon(url,b))continue;
try{fetch(url,{method:"POST",body:b,keepalive:!0,credentials:"omit",headers:{"Content-Type":"text/plain"}})["catch"](noop)}catch(e){}}}
function view(){capture("$pageview",{title:d.title})}
function nav(){if(L.pathname==P)return;capture("$pageleave",{$pathname:P,$current_url:H});P=L.pathname;H=L.href;setTimeout(view,0)}
function text(el){var t=el.tagName,v=t=="INPUT"?(/^(submit|button|reset)$/i.test(el.type)?el.value:""):t=="SELECT"||t=="TEXTAREA"?"":el.innerText||el.textContent||"";
v=v||el.getAttribute("aria-label")||el.getAttribute("title")||el.getAttribute("alt")||"";
return v.replace(/\\s+/g," ").trim().slice(0,64)}
function esc(x){return w.CSS&&CSS.escape?CSS.escape(x):x}
function sel(el){for(var o=[],i=0;el&&el.nodeType==1&&i<4;i++,el=el.parentElement){
var t=el.tagName.toLowerCase(),a=el.getAttribute("data-darwin");
if(el.id){o.unshift(t+"#"+esc(el.id));break}
if(a){o.unshift(t+'[data-darwin="'+a+'"]');break}
var c=(el.getAttribute("class")||"").split(/\\s+/).filter(Boolean).slice(0,2);
o.unshift(t+(c.length?"."+c.map(esc).join("."):""))}
return o.join(" > ")}
["pushState","replaceState"].forEach(function(f){var o=history[f];history[f]=function(){var r=o.apply(this,arguments);nav();return r}});
w.addEventListener("popstate",nav);
d.addEventListener("click",function(e){var el=e.target;if(!el||el.nodeType!=1)return;
el=(el.closest&&el.closest("a,button,input,select,textarea,label,[role=button],[data-darwin]"))||el;
var h=el.getAttribute("href"),now=Date.now(),p={$event_type:"click",$el_tag:el.tagName.toLowerCase(),$el_text:text(el),$selector:sel(el)};
if(h)p.$el_href=h.slice(0,200);
capture("$autocapture",p);
if(el!==X){X=el;C=[]}
C=C.filter(function(x){return now-x<1e3});C.push(now);
if(C.length==3)capture("$rageclick",p)},!0);
w.addEventListener("pagehide",function(){if(!left){left=1;capture("$pageleave")}flush(!0)});
w.addEventListener("pageshow",function(e){if(e.persisted){left=0;view()}});
d.addEventListener("visibilitychange",function(){if(d.visibilityState=="hidden")flush(!0)});
w.darwin={v:1,capture:capture,flush:flush,site:site,distinctId:function(){return id}};
for(var i=0;i<pre.length;i++)capture(pre[i][0],pre[i][1]);
view()})(window,document);
`;
