/*
 * LOCAL-ONLY mirror runtime (served by mirror/serve.mjs, never deployed). Applies the PageSpec in
 * storefront.config.json to a mirrored page (window.__ORCHARD_SPEC__), and sends the same funnel events
 * as the Next app (lib/track.ts) through darwin.js. Every transform is best-effort: if the mirrored markup
 * changes, a step is skipped and logged, never fatal.
 */
(function () {
  "use strict";
  var spec = window.__ORCHARD_SPEC__ || {};
  var kind = window.__ORCHARD_PAGE__ || "";
  var PRODUCT = { id: "orchard-phone-17-pro", name: "Orchard Phone 17 Pro", price: 109900, colour: "Ember", option: "256GB" };
  var RETURNS_DAYS = 14;

  function track(event, props) {
    var p = { store: "orchard", mirror: true, orchard_config_version: spec.version };
    for (var k in props || {}) p[k] = props[k];
    (window.orchardEvents = window.orchardEvents || []).push({ event: event, props: p });
    var d = window.darwin;
    if (d && !Array.isArray(d) && typeof d.capture === "function") d.capture(event, p);
    else if (Array.isArray(d)) d.push([event, p]);
    else window.darwin = [[event, p]];
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function byText(sel, re) {
    return $$(sel).filter(function (el) {
      return re.test((el.textContent || "").trim());
    });
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function step(name, fn) {
    try {
      fn();
    } catch (e) {
      console.warn("[orchard mirror] skipped " + name + ": " + e.message);
    }
  }
  function deliveryDate() {
    var d = new Date();
    var days = d.getHours() < 15 ? 1 : 2;
    while (days > 0) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) days--;
    }
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  function stars(rating, count) {
    return (
      '<span data-darwin="rating" style="display:inline-flex;gap:6px;align-items:center;font-size:14px;color:#6e6e73">' +
      '<span style="color:#f56300;letter-spacing:1px">★★★★★</span>' +
      rating.toFixed(1) +
      (count ? " (" + count.toLocaleString("en-GB") + " reviews)" : "") +
      "</span>"
    );
  }
  var css = document.createElement("style");
  css.textContent =
    ".orchard-badges{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin-top:16px;padding-top:14px;border-top:1px solid #d2d2d7;font-size:12px;color:#6e6e73;list-style:none}" +
    ".orchard-fact{display:flex;gap:8px;margin-top:10px;font-size:14px;line-height:1.43;color:#1d1d1f}" +
    ".orchard-sticky{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;gap:20px;justify-content:center;padding:12px 22px;background:rgba(255,255,255,.86);backdrop-filter:saturate(180%) blur(20px);box-shadow:0 -1px 0 rgba(0,0,0,.1);transform:translateY(110%);transition:transform .4s}" +
    ".orchard-sticky.show{transform:none}.orchard-sticky button{border:0;border-radius:980px;background:#0071e3;color:#fff;padding:8px 18px;font-size:14px;cursor:pointer}";
  document.head.appendChild(css);

  /* ---------------------------------------------------------------- every page */

  step("announcement", function () {
    var ribbon = $(".section-ribbon, .rs-ribbon, .ribbon, [class*='ribbon-drop-wrapper']");
    if (!ribbon) return;
    var a = spec.announcement || {};
    if (!a.enabled || !a.text) {
      ribbon.style.display = "none";
      return;
    }
    var p = $("p", ribbon) || ribbon;
    p.setAttribute("data-darwin", "announcement");
    p.innerHTML = a.text + ' <a href="/store" style="color:#0066cc">Shop ›</a>';
  });
  step("chat widget", function () {
    $$("[class*='chat-'], [class*='as-chat'], [class*='rs-chat']").forEach(function (n) {
      if (n.getBoundingClientRect().width < 120) n.style.display = "none";
    });
  });

  /* ---------------------------------------------------------------- home */

  if (kind === "home") {
    step("static hero images", function () {
      // Videos aren't mirrored: show each tile's static picture instead of the (empty) player.
      $$(".tile-image-wrapper, .tile-wrapper").forEach(function (tile) {
        var still = $("picture.static", tile);
        if (!still) return;
        $$(".inline-media-wrapper", tile).forEach(function (m) {
          m.style.display = "none";
        });
        still.style.cssText += ";display:block !important;opacity:1 !important;visibility:visible !important";
      });
    });
    step("hero cta", function () {
      var hero = $(".section-hero .tile-wrapper, .section-hero");
      var btn = hero && $(".tile-ctas a.button:not(.button-secondary)", hero);
      if (!btn || !spec.hero) return;
      btn.textContent = spec.hero.ctaText;
      btn.setAttribute("data-darwin", "hero-cta");
      if (/\b(buy|shop|order|get|bag|add)\b/i.test(spec.hero.ctaText)) btn.setAttribute("href", "/buy/phone");
      if (spec.hero.showSocialProof) {
        var line = el('<p data-darwin="social-proof" style="margin-top:14px;display:flex;justify-content:center;position:relative;z-index:3">' + stars(4.8, 2184) + "</p>");
        btn.parentNode.parentNode.appendChild(line);
      }
    });
  }

  /* ---------------------------------------------------------------- store */

  if (kind === "store" && spec.productGrid && spec.productGrid.showRatings) {
    step("grid ratings", function () {
      $$(".rf-ccard-content-header, .rf-productnav-card-title").forEach(function (h, i) {
        h.insertAdjacentHTML("afterend", '<div style="margin-top:6px">' + stars(4.9 - (i % 4) / 10, 800 + i * 137) + "</div>");
      });
    });
  }

  /* ---------------------------------------------------------------- buy page */

  if (kind === "buy") {
    var pp = spec.productPage || {};
    var cart = spec.cart || {};
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";
    track("product_viewed", { product_id: PRODUCT.id, name: PRODUCT.name, price: PRODUCT.price, cta_position: pp.ctaPosition });

    step("enable configurator", function () {
      // Without the store's own scripts every option stays greyed out: show them as selectable.
      $$("[inert]").forEach(function (n) {
        n.removeAttribute("inert");
      });
      $$("[disabled]").forEach(function (n) {
        n.removeAttribute("disabled");
        n.removeAttribute("aria-disabled");
      });
      $$("[class*='disabled'], [class*='not-buyable']").forEach(function (n) {
        n.className = String(n.className)
          .split(/\s+/)
          .filter(function (c) {
            return !/disabled|not-buyable/.test(c);
          })
          .join(" ");
      });
    });

    var summary = $(".rf-bfe-summary-wrapper") || (byText("button", /^continue$/i)[0] || {}).closest?.("section");
    var header = $(".rf-bfe-header") || $("h1");

    step("add to bag button", function () {
      var btn = $("[data-autom='continueButton']", summary) || byText("button", /^(continue|add to bag)$/i)[0];
      if (!btn) throw new Error("no Continue button");
      btn.textContent = pp.ctaText || "Add to Bag";
      btn.setAttribute("data-darwin", "add-to-bag");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        addToBag("buy-summary");
      });
    });

    step("cta position", function () {
      if (!summary) throw new Error("no summary block");
      summary.setAttribute("data-darwin", "buy-summary");
      if (pp.ctaPosition === "below-description") {
        // The flaw: Add to Bag only after every spec, comparison table and footnote.
        var footer = $("#globalfooter, footer, .ac-gf-footer");
        var anchor = footer ? footer.closest("#globalfooter, footer") || footer : null;
        (anchor ? anchor.parentNode : document.body).insertBefore(summary, anchor);
      } else {
        var top = header.closest(".rf-bfe-header") || header.parentNode;
        top.parentNode.insertBefore(summary, top.nextSibling);
      }
    });

    step("delivery estimate", function () {
      var note = byText("div, p", /^Delivery details for your area will be shown in Checkout\.?$/)[0];
      if (pp.showDeliveryEstimate) {
        var line = '<strong>Delivery:</strong> order by 3pm, delivers ' + deliveryDate() + (cart.freeShippingThreshold !== null && cart.freeShippingThreshold <= PRODUCT.price ? " – Free" : "");
        if (note) {
          note.innerHTML = line;
          note.setAttribute("data-darwin", "delivery-estimate");
        } else summary.appendChild(el('<p class="orchard-fact" data-darwin="delivery-estimate">' + line + "</p>"));
      }
      if (!cart.showShippingUpfront) {
        // Delivery cost only appears at the final checkout step, so don't promise it here.
        byText(".rf-bfe-availability-buystrip-title, p", /^Free (shipping|delivery)$/i).forEach(function (n) {
          (n.closest("li, .rf-bfe-availability-buystrip-item, div") || n).style.display = "none";
        });
      }
    });

    step("returns + trust", function () {
      var box = $(".rf-bfe-summary-button-box-fullWidth, .rc-summary-button", summary) || summary;
      if (pp.showReturnsPolicy)
        box.insertAdjacentHTML("beforebegin", '<p class="orchard-fact" data-darwin="returns-policy"><strong>Free returns</strong>&nbsp;within ' + RETURNS_DAYS + " days.</p>");
      if (pp.trustBadges)
        box.insertAdjacentHTML(
          "afterend",
          '<ul class="orchard-badges" data-darwin="trust-badges"><li>🔒 Secure checkout</li><li>🛡 1-year warranty</li><li>↩ ' + RETURNS_DAYS + "-day free returns</li><li>💳 0% finance available</li></ul>",
        );
      if (pp.urgency === "low-stock") box.insertAdjacentHTML("beforebegin", '<p class="orchard-fact" data-darwin="urgency" style="color:#b64400;font-weight:600">Only 3 left in this finish.</p>');
    });

    step("reviews", function () {
      if (!pp.showReviews) return;
      var h1 = $("h1");
      h1 && h1.insertAdjacentHTML("afterend", '<div style="margin:8px 0">' + stars(4.8, 2184) + "</div>");
    });

    step("size guide", function () {
      if (pp.showSizeGuide) return;
      byText("button, a, div", /^Need help choosing/i).forEach(function (n) {
        var box = n.closest("[class*='helpbutton'], [class*='help'], li, div");
        if (box && box.getBoundingClientRect().height < 200) box.style.display = "none";
      });
    });

    step("sticky bar", function () {
      if (pp.ctaPosition !== "sticky") return;
      var bar = el('<div class="orchard-sticky" data-darwin="sticky-add-to-bag"><span><strong>' + PRODUCT.name + "</strong> · £1,099.00</span><button type=\"button\">" + (pp.ctaText || "Add to Bag") + "</button></div>");
      document.body.appendChild(bar);
      $("button", bar).addEventListener("click", function () {
        addToBag("sticky-bar");
      });
      var io = new IntersectionObserver(function (entries) {
        bar.classList.toggle("show", !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0);
      });
      io.observe(summary);
    });
  }

  function addToBag(source) {
    var bag = [];
    try {
      bag = JSON.parse(localStorage.getItem("orchard_bag") || "[]");
    } catch (e) {}
    var line = bag.find(function (l) {
      return l.slug === PRODUCT.id && l.colour === PRODUCT.colour && l.option === PRODUCT.option;
    });
    if (line) line.qty += 1;
    else bag.push({ slug: PRODUCT.id, colour: PRODUCT.colour, option: PRODUCT.option, qty: 1 });
    localStorage.setItem("orchard_bag", JSON.stringify(bag));
    track("product_added", { product_id: PRODUCT.id, name: PRODUCT.name, price: PRODUCT.price, quantity: 1, colour: PRODUCT.colour, option: PRODUCT.option, source: source });
    var d = window.darwin;
    if (d && d.flush) d.flush(true);
    setTimeout(function () {
      location.href = "/bag";
    }, 150);
  }
})();
