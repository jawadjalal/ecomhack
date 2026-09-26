import { listRules } from "@/lib/web";

export const dynamic = "force-dynamic";

/**
 * GET /demo/north-trail: a store Darwin did NOT build. Plain HTML, no framework, no PageSpec: the
 * only Darwin thing on it is the darwin.js tag (plus the runtime in <head> to avoid flicker). It's
 * here to show web personalization working on "any store": the console changes it per traffic source.
 */
export function GET(req: Request) {
  // Bust the runtime's short cache whenever a rule changes, so the demo updates instantly.
  const version = listRules("north-trail").reduce((v, r) => (r.updatedAt > v ? r.updatedAt : v), "0");
  // The console previews unlaunched drafts with ?darwin_preview=<rule id> (as darwin.js does on other stores).
  const preview = new URL(req.url).searchParams.get("darwin_preview")?.match(/^[\w-]{1,40}$/)?.[0];
  return new Response(page(encodeURIComponent(version) + (preview ? `&darwin_preview=${preview}` : "")), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const PRODUCTS = [
  { id: "ridge-moss", name: "Ridge Trail Pro", colour: "Moss", price: 11900, img: "/products/ridge--moss.svg" },
  { id: "summit", name: "Summit GTX", colour: "Waterproof", price: 13900, img: "/products/summit.svg" },
  { id: "ridge-slate", name: "Ridge Trail Pro", colour: "Slate", price: 11900, img: "/products/ridge--slate.svg" },
];

const gbp = (p: number) => `£${(p / 100).toFixed(0)}`;

const page = (query: string) => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>North Trail · Trail running shoes</title>
<meta name="description" content="Trail running shoes built for mud. Free UK delivery over £60, free 60-day returns.">
<script src="/api/web/runtime.js?site=north-trail&v=${query}"></script>
<script async src="/darwin.js" data-darwin-site="north-trail"></script>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2a22;background:#f6f2ea}
a{color:inherit}header.top{display:flex;align-items:center;gap:16px;padding:14px 24px;background:#fff;border-bottom:1px solid #e6dfd2;position:sticky;top:0;z-index:5}
.logo{font-weight:800;letter-spacing:.18em;font-size:15px;text-decoration:none}.logo span{color:#3f7a4f}
nav{display:flex;gap:18px;font-size:14px;color:#55635a}nav a{text-decoration:none}
form.search{margin-left:auto;display:flex}form.search input{height:36px;width:min(240px,40vw);border:1px solid #d9d1c2;border-radius:10px 0 0 10px;padding:0 12px;font:inherit;font-size:14px;background:#fbf9f5}
form.search button{height:36px;border:1px solid #d9d1c2;border-left:0;border-radius:0 10px 10px 0;background:#fff;padding:0 12px;cursor:pointer}
.cart{height:36px;border-radius:10px;border:0;background:#1d2a22;color:#fff;padding:0 14px;font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;align-items:center;max-width:1100px;margin:0 auto;padding:56px 24px 32px}
.hero-title{font-size:clamp(34px,5vw,56px);line-height:1.05;margin:0 0 14px;letter-spacing:-.02em}
.hero-sub{font-size:18px;color:#55635a;margin:0 0 24px;max-width:34rem}
.hero img{width:100%;border-radius:24px;background:#e8e1d3}
.shop-now{display:inline-block;background:#3f7a4f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600}
.grid{max-width:1100px;margin:0 auto;padding:8px 24px 48px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{background:#fff;border:1px solid #e6dfd2;border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:8px}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#efe9dd}
.card h3{margin:4px 0 0;font-size:17px}.meta{display:flex;justify-content:space-between;color:#55635a;font-size:14px}.price{font-weight:700;color:#1d2a22}
.add-to-cart{margin-top:6px;height:42px;border:0;border-radius:12px;background:#1d2a22;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.add-to-cart:active{transform:scale(.98)}
.usp{max-width:1100px;margin:0 auto 48px;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:14px;color:#55635a}
.usp div{background:#fff;border:1px solid #e6dfd2;border-radius:14px;padding:12px 14px}
.promo-popup{position:fixed;right:20px;bottom:20px;width:300px;background:#fff;border:1px solid #e6dfd2;border-radius:16px;padding:16px 16px 14px;box-shadow:0 20px 50px -20px rgba(0,0,0,.35);z-index:10}
.promo-popup strong{display:block;font-size:16px}.promo-popup p{margin:4px 0 10px;font-size:14px;color:#55635a}
.promo-popup input{width:100%;height:36px;border:1px solid #d9d1c2;border-radius:10px;padding:0 10px;font:inherit;font-size:14px}
.promo-popup .close{position:absolute;top:8px;right:10px;border:0;background:none;font-size:18px;cursor:pointer;color:#7a877f}
.thanks{display:none;max-width:1100px;margin:16px auto 0;padding:12px 16px;border-radius:12px;background:#e3f1e5;color:#1f5130;font-weight:600}
footer{border-top:1px solid #e6dfd2;padding:20px 24px;font-size:13px;color:#7a877f;text-align:center}
@media (max-width:760px){.hero{grid-template-columns:1fr;padding-top:28px}.grid,.usp{grid-template-columns:1fr}nav{display:none}.promo-popup{left:16px;right:16px;width:auto}}
</style>
</head>
<body>
<header class="top">
  <a class="logo" href="/demo/north-trail">NORTH<span>TRAIL</span></a>
  <nav><a href="#shop">Men</a><a href="#shop">Women</a><a href="#shop">Waterproof</a></nav>
  <form class="search" action="/demo/north-trail" method="get" role="search">
    <input name="q" type="search" placeholder="Search trail shoes" aria-label="Search">
    <button type="submit" aria-label="Search">⌕</button>
  </form>
  <button class="cart" id="checkout" type="button">Cart (<span id="count">0</span>) · Checkout</button>
</header>
<div class="thanks" id="thanks" role="status">Order placed. Thanks for shopping with North Trail!</div>

<section class="hero">
  <div>
    <h1 class="hero-title">Trail shoes built for mud</h1>
    <p class="hero-sub">Grippy, waterproof and light. Tested on the wettest hills in Scotland.</p>
    <a class="shop-now" href="#shop">Shop the range</a>
  </div>
  <img src="/products/summit.svg" alt="Summit GTX trail shoe" width="600" height="450">
</section>

<main class="grid" id="shop">
${PRODUCTS.map(
  (p) => `  <article class="card">
    <img src="${p.img}" alt="${p.name} in ${p.colour}" width="400" height="300" loading="lazy">
    <h3>${p.name}</h3>
    <div class="meta"><span>${p.colour}</span><span class="price">${gbp(p.price)}</span></div>
    <button class="add-to-cart" type="button" data-id="${p.id}" data-price="${p.price}">Add to cart</button>
  </article>`,
).join("\n")}
</main>

<section class="usp"><div>Free UK delivery over £60</div><div>Free 60-day returns</div><div>Dispatched within 24 hours</div></section>

<aside class="promo-popup" aria-label="Newsletter">
  <button class="close" type="button" aria-label="Close">×</button>
  <strong>Get 10% off your first order</strong>
  <p>Join the North Trail list for trail tips and early drops.</p>
  <input type="email" placeholder="you@example.com" aria-label="Email">
</aside>

<footer>North Trail is a demo store in plain HTML, not built with Darwin. The only Darwin code on it is two script tags.</footer>

<script>
(function(){
  var cart = [], count = document.getElementById("count");
  function capture(e, p){ var d = window.darwin; if (d && d.capture) d.capture(e, p); else (window.darwin = window.darwin || []).push([e, p]); }
  document.querySelectorAll(".add-to-cart").forEach(function(b){
    b.addEventListener("click", function(){
      var price = Number(b.getAttribute("data-price"));
      cart.push(price); count.textContent = String(cart.length);
      capture("product_added", { product_id: b.getAttribute("data-id"), price: price, quantity: 1 });
    });
  });
  document.getElementById("checkout").addEventListener("click", function(){
    if (!cart.length) { document.getElementById("shop").scrollIntoView({ behavior: "smooth" }); return; }
    var revenue = cart.reduce(function(a, b){ return a + b; }, 0);
    capture("order_completed", { revenue: revenue, items: cart.length });
    cart = []; count.textContent = "0";
    var t = document.getElementById("thanks"); t.style.display = "block"; window.scrollTo({ top: 0, behavior: "smooth" });
  });
  var pop = document.querySelector(".promo-popup .close");
  if (pop) pop.addEventListener("click", function(){ pop.parentNode.style.display = "none"; });
})();
</script>
</body>
</html>
`;
