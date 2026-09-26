/*
 * LOCAL-ONLY mirror runtime. Runs on the captured pages served by mirror/server.mjs.
 *
 * 1. Applies the planted conversion flaws from storefront.config.json (window.__RACKD_SPEC), the same
 *    PageSpec knobs as the committed store, so a Darwin PR that fixes the config fixes this copy too:
 *      hero.ctaText / showSocialProof     weak hero button; press strip, buyer count, testimonials hidden
 *      productPage.ctaPosition            "below-description" moves Add to cart under the description
 *      productPage.showReturnsPolicy / trustBadges / showDeliveryEstimate / showReviews
 *                                         buyer protection, shipping & customs, reviews, quality score hidden
 *      productGrid.showRatings            star ratings hidden on supplier cards
 *      cart.showShippingUpfront           "Shipping Inc." labels hidden; fees only at the last checkout step
 *      checkout.*                         the checkout itself is the store app's (/checkout), proxied here
 * 2. Sends Darwin's funnel events (product_viewed, product_added) and routes cart / account links to the
 *    store app. 3. Adds a "Demo copy, not affiliated with Fleek" note.
 */
(function () {
  "use strict";
  var S = window.__RACKD_SPEC || {};
  var M = window.__MIRROR || { page: "other" };
  var pp = S.productPage || {};
  var d = document;

  function track(ev, props) {
    props = props || {};
    props.currency = "GBP";
    props.config_version = S.version;
    props.config_label = S.label;
    props.mirror = true;
    var dw = window.darwin;
    if (dw && !Array.isArray(dw) && dw.capture) dw.capture(ev, props);
    else (window.darwin = Array.isArray(dw) ? dw : []).push([ev, props]);
  }
  function hide(el) {
    if (el) el.style.setProperty("display", "none", "important");
  }
  function leaves(re) {
    var out = [];
    var all = d.body.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && re.test((el.textContent || "").trim())) out.push(el);
    }
    return out;
  }
  function up(el, n) {
    while (el && n-- > 0 && el.parentElement && el.parentElement !== d.body) el = el.parentElement;
    return el;
  }
  /** Climb while the parent still holds only this one match of `re`. */
  function block(el, re, max) {
    var cur = el;
    for (var i = 0; i < (max || 6); i++) {
      var p = cur.parentElement;
      if (!p || p === d.body || p.tagName === "MAIN") break;
      var t = p.textContent || "";
      var m = t.match(new RegExp(re.source, "gi"));
      if (m && m.length > 1) break;
      if (t.length > 1200) break;
      cur = p;
    }
    return cur;
  }
  function deepest(phrase) {
    var found = null;
    var all = d.body.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) if ((all[i].textContent || "").indexOf(phrase) >= 0) found = all[i];
    // Document order puts ancestors before descendants, so the last hit is the innermost element holding the phrase.
    return found;
  }
  function fixedAncestor(el) {
    for (var e = el; e && e !== d.body; e = e.parentElement) {
      var pos = getComputedStyle(e).position;
      if (pos === "fixed" || pos === "sticky") return e;
    }
    return null;
  }
  function pence(text) {
    var m = String(text).replace(/,/g, "").match(/£\s*(\d+(?:\.\d{1,2})?)/);
    return m ? Math.round(parseFloat(m[1]) * 100) : NaN;
  }

  // ---------------------------------------------------------------- note
  var note = d.createElement("div");
  note.className = "rk-note";
  note.textContent = "Demo copy, not affiliated with Fleek · local only · config: " + (S.label || "v" + S.version);
  d.body.appendChild(note);

  // ---------------------------------------------------------------- promo / announcement
  if (S.announcement && S.announcement.enabled && S.announcement.text) {
    // The promo strip: climb from its text while the parent is still just the strip (not the header).
    var bar = leaves(/APPFIRSTORDER|Download app/i)[0];
    while (bar && bar.parentElement && !/Categories|Login|Sign Up/i.test(bar.parentElement.textContent || "")) bar = bar.parentElement;
    if (bar) {
      bar.textContent = S.announcement.text;
      bar.classList.add("rk-announce");
      bar.setAttribute("data-darwin", "announcement");
    }
  }

  // ---------------------------------------------------------------- links → store app
  function wire(sel, href) {
    var els = d.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var a = els[i].closest("a,button") || els[i];
      a.setAttribute("data-rk-href", href);
      a.style.cursor = "pointer";
    }
  }
  wire('img[alt="cart-icon"], img[alt*="cart" i]:not([alt="cart icon"])', "/cart");
  var authButtons = leaves(/^(Sign Up|Login|Log in)$/i);
  for (var ab = 0; ab < authButtons.length; ab++) {
    var b = authButtons[ab].closest("a,button") || authButtons[ab];
    b.setAttribute("data-rk-href", /sign/i.test(authButtons[ab].textContent) ? "/account?mode=signup" : "/account");
  }
  d.addEventListener(
    "click",
    function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-rk-href]");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      location.href = t.getAttribute("data-rk-href");
    },
    true,
  );

  // ---------------------------------------------------------------- flaws: social proof + hero CTA
  if (M.page === "home") {
    if (!(S.hero && S.hero.showSocialProof)) {
      hide(d.querySelector("section.cf-as-seen-in"));
      hide(d.querySelector("section.cf-testimonials"));
      // The "45,000+ buyers" row: the platform logos image and the sentence next to it.
      leaves(/buyers source on/i).forEach(function (el) {
        var row = el.closest("div");
        var img = d.querySelector('img[alt*="Vinted" i], img[alt*="eBay" i]');
        hide(img && row && row.parentElement && row.parentElement.contains(img) && row.parentElement.textContent.length < 120 ? row.parentElement : row);
        hide(img);
      });
    }
    var h1 = d.querySelector("h1");
    if (h1 && S.hero && S.hero.ctaText) {
      var cta = d.createElement("a");
      cta.href = "/collections/all";
      cta.className = "rk-hero-cta";
      cta.id = "hero-cta";
      cta.setAttribute("data-darwin", "hero-cta");
      cta.textContent = S.hero.ctaText;
      var sub = h1.nextElementSibling;
      (sub || h1).insertAdjacentElement("afterend", cta);
    }
  }

  // ---------------------------------------------------------------- flaws: shipping shown late
  if (!(S.cart && S.cart.showShippingUpfront)) {
    leaves(/^(shipping inc\.?|free shipping)$/i).forEach(hide);
    leaves(/^shipping included$/i).forEach(function (el) {
      hide(block(el, /shipping included/, 3));
    });
  }

  // ---------------------------------------------------------------- flaws: trust signals
  if (!pp.showReturnsPolicy && !pp.trustBadges) {
    leaves(/buyer protection/i).forEach(function (el) {
      hide(block(el, /buyer protection/, 4));
    });
  }
  if (!pp.showDeliveryEstimate) {
    leaves(/^shipping (&|and) customs$/i).forEach(function (el) {
      hide(block(el, /shipping (&|and) customs/, 3));
    });
    leaves(/^dispatch time$/i).forEach(function (el) {
      hide(el.parentElement);
    });
  }
  if (!pp.showReviews) {
    leaves(/^what buyers are saying$/i).forEach(function (el) {
      hide(up(el, 3));
    });
    leaves(/quality score/i).forEach(function (el) {
      hide(el.parentElement);
    });
  }
  if (!(S.productGrid && S.productGrid.showRatings)) {
    leaves(/^★+/).forEach(function (el) {
      hide(el.parentElement && el.parentElement.children.length <= 2 ? el.parentElement : el);
    });
  }

  // ---------------------------------------------------------------- product page: CTA position + events
  if (M.page === "product") {
    var title = d.querySelector("h1");
    var name = title ? title.textContent.trim() : d.title;
    var priceEl = d.querySelector(".product-price-container") || (title && title.parentElement);
    var ptext = priceEl ? priceEl.textContent : "";
    var total = pence((ptext.match(/\(\s*£[\d,.]+\s*\)/) || [ptext])[0]);
    var pcs = parseInt(((d.body.textContent.match(/Quantity:\s*(\d+)\s*pcs/i) || [])[1] || "1"), 10);
    var id = "fleek-" + (location.pathname.split("/").pop() || "item");
    var imgs = d.querySelectorAll("img");
    var image;
    for (var ii = 0; ii < imgs.length; ii++) {
      var r = imgs[ii].getBoundingClientRect();
      if (r.width > 200 && r.height > 200) {
        image = imgs[ii].getAttribute("src");
        break;
      }
    }
    track("product_viewed", { product_id: id, price: total, pieces: pcs });

    // The page's own add-to-cart buttons: the main one, plus any sticky bar the site shows on scroll.
    var labels = leaves(/^add to cart$/i);
    var atcLabel = null;
    for (var li = 0; li < labels.length; li++) {
      var bar0 = fixedAncestor(labels[li]);
      if (bar0) {
        if (pp.ctaPosition !== "sticky") hide(bar0);
      } else if (!atcLabel) atcLabel = labels[li];
    }
    var atc = atcLabel && atcLabel.closest("button");
    if (atc) {
      atc.setAttribute("id", "add-to-cart");
      atc.setAttribute("data-darwin", "add-to-cart");
      if (pp.ctaText) atcLabel.textContent = pp.ctaText;
      var buyRow = atc.parentElement;
      if (pp.ctaPosition === "below-description") {
        // Move the quantity + add-to-cart block (the smallest container holding both) below the description.
        var qty = leaves(/^quantity:?$/i)[0];
        var moving = buyRow;
        if (qty) {
          var c2 = qty;
          while (c2 && !c2.contains(atc)) c2 = c2.parentElement;
          if (c2 && (c2.textContent || "").indexOf("The images and videos") < 0 && (c2.textContent || "").length < 400) moving = c2;
        }
        var desc = deepest("The images and videos") || deepest("Grade:");
        var anchor = desc;
        while (anchor && anchor.parentElement && !anchor.parentElement.contains(moving)) anchor = anchor.parentElement;
        if (anchor && anchor !== moving && !anchor.contains(moving)) {
          anchor.insertAdjacentElement("afterend", moving);
          moving.classList.add("rk-buried");
        }
      } else if (pp.ctaPosition === "sticky") {
        var bar2 = d.createElement("div");
        bar2.className = "rk-sticky";
        bar2.innerHTML = '<div class="rk-sticky-name"></div><button type="button" class="rk-sticky-btn"></button>';
        bar2.querySelector(".rk-sticky-name").textContent = name;
        bar2.querySelector(".rk-sticky-btn").textContent = pp.ctaText || "Add to cart";
        bar2.querySelector(".rk-sticky-btn").addEventListener("click", function () {
          atc.click();
        });
        d.body.appendChild(bar2);
        d.body.classList.add("rk-has-sticky");
      }
      if (pp.trustBadges || pp.showReturnsPolicy) {
        var trust = d.createElement("div");
        trust.className = "rk-trust";
        trust.setAttribute("data-darwin", "trust-badges");
        trust.textContent = "✓ Buyer protection   ✓ Verified supplier   ✓ Customs handled   ✓ Secure checkout";
        if (pp.trustBadges) buyRow.insertAdjacentElement("afterend", trust);
      }
      atc.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopPropagation();
          var cart = [];
          try {
            cart = JSON.parse(localStorage.getItem("rackd_cart") || "[]");
          } catch (err) {}
          var line = null;
          for (var c = 0; c < cart.length; c++) if (cart[c].id === id) line = cart[c];
          if (line) line.qty += 1;
          else cart.push({ id: id, qty: 1, ext: { name: name, price: total, pieces: pcs, image: image, url: location.pathname } });
          localStorage.setItem("rackd_cart", JSON.stringify(cart));
          track("product_added", { product_id: id, price: total, quantity: 1, source: "mirror_pdp" });
          var toast = d.createElement("div");
          toast.className = "rk-toast";
          toast.innerHTML = 'Added to cart <a href="/cart">View cart</a>';
          d.body.appendChild(toast);
          setTimeout(function () {
            toast.remove();
          }, 3000);
        },
        true,
      );
    }
  }
})();
