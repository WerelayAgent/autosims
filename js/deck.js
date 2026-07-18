/* ============================================================
   AutoSims — horizontal deck controller (deck.js)
   Vanilla, no deps. Turns the vertical wheel into left→right
   deck navigation, wires the top-nav + CTAs + progress dots,
   and lets inner panes (chat feed, leaderboard, tall slides)
   keep their native vertical scroll until they hit an edge.
   ============================================================ */
(function () {
  "use strict";

  var deck = document.getElementById("deck");
  if (!deck) return;

  // enforce "the deck is the only scroller" (belt-and-braces with deck.css)
  document.documentElement.classList.add("deckhtml");

  var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
  var n = slides.length;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var dotsWrap = document.getElementById("deckDots");
  var idxEl = document.getElementById("deckIdx");
  var nameEl = document.getElementById("deckName");
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".deckbar__nav a[data-goto]"));
  var dots = [];

  /* ---------- geometry helpers ---------- */
  function slideW() { return deck.clientWidth || window.innerWidth || 1; }
  function current() { return Math.max(0, Math.min(n - 1, Math.round(deck.scrollLeft / slideW()))); }

  function goTo(i) {
    i = Math.max(0, Math.min(n - 1, i));
    var left = i * slideW();
    if (deck.scrollTo) deck.scrollTo({ left: left, behavior: reduce ? "auto" : "smooth" });
    else deck.scrollLeft = left;
  }

  /* ---------- progress dots ---------- */
  if (dotsWrap) {
    slides.forEach(function (s, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "deckdots__dot" + (i === 0 ? " is-active" : "");
      b.setAttribute("role", "tab");
      var nm = s.getAttribute("data-name") || ("Slide " + (i + 1));
      b.setAttribute("aria-label", "Go to slide " + (i + 1) + ": " + nm);
      b.addEventListener("click", function () { goTo(i); });
      dotsWrap.appendChild(b);
      dots.push(b);
    });
  }

  /* ---------- active-state sync ---------- */
  function setActive(i) {
    if (idxEl) idxEl.textContent = ("0" + (i + 1)).slice(-2);
    if (nameEl && slides[i]) nameEl.textContent = slides[i].getAttribute("data-name") || "";
    dots.forEach(function (d, di) {
      var on = di === i;
      d.classList.toggle("is-active", on);
      if (on) d.setAttribute("aria-selected", "true"); else d.removeAttribute("aria-selected");
    });
    navLinks.forEach(function (a) {
      a.classList.toggle("is-active", Number(a.getAttribute("data-goto")) === i);
    });
  }

  /* ---------- wheel → horizontal, respecting inner vertical panes ----------
     If the wheel is vertical and the pointer is over an inner pane that can
     still scroll vertically in that direction (chat feed, leaderboard list,
     an overflowing slide), let the browser do the native vertical scroll.
     Otherwise convert the dominant delta into horizontal deck movement. */
  function canScrollV(el, dir) {
    if (!el || el.nodeType !== 1) return false;
    if (el.scrollHeight - el.clientHeight <= 1) return false;
    if (dir > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1; // room to scroll down
    return el.scrollTop > 1;                                                  // room to scroll up
  }
  // ONLY these inner panes keep their own vertical wheel scroll; everything else
  // (including the slide body) turns vertical wheel into horizontal deck movement.
  var VSCROLL_SEL = ".direct, .chat__feed, .lboard__list, .board__minds, .board__qfeed, .payout__body, [data-vscroll]";
  function innerPaneWants(target, dir) {
    var node = target;
    while (node && node !== deck && node.nodeType === 1) {
      if (node.matches && node.matches(VSCROLL_SEL) && canScrollV(node, dir)) return true;
      node = node.parentNode;
    }
    return false;
  }

  // FREE native scroll: the vertical wheel / trackpad drives the deck's scrollLeft
  // 1:1 — real-time, with the trackpad's own momentum. Nothing locks, nothing
  // auto-advances, nothing snaps. Inner panes (chat / leaderboard / dashboard /
  // queue) keep their own vertical scroll. Nav / dots / arrow keys still glide.
  deck.addEventListener("wheel", function (e) {
    if (e.ctrlKey) return; // pinch-zoom — leave it alone
    var ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
    var delta = ay >= ax ? e.deltaY : e.deltaX; // vertical wheel drives horizontal deck
    if (delta === 0) return;
    var vertical = ay >= ax;
    // The Live slide is a wall of scrollable columns (stream / chat / minds / queue /
    // Direct-a-mind). A vertical wheel there is meant for those columns, so NEVER turn
    // it into sideways deck movement — that made "scroll a column" jump the whole page.
    // The browser scrolls whichever column is under the cursor; you move off this slide
    // with a horizontal swipe, the nav, the dots, or the arrow keys.
    if (vertical && e.target && e.target.closest && e.target.closest(".slide--live")) return;
    if (vertical && innerPaneWants(e.target, e.deltaY)) return;
    e.preventDefault();
    deck.scrollLeft += delta;
  }, { passive: false });

  /* ---------- keyboard nav (ignore while typing) ---------- */
  document.addEventListener("keydown", function (e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var cur = current();
    switch (e.key) {
      case "ArrowRight": case "PageDown": e.preventDefault(); goTo(cur + 1); break;
      case "ArrowLeft":  case "PageUp":   e.preventDefault(); goTo(cur - 1); break;
      case "Home": e.preventDefault(); goTo(0); break;
      case "End":  e.preventDefault(); goTo(n - 1); break;
      default: break;
    }
  });

  /* ---------- [data-goto] jumps: top-nav, brand, intro CTAs, scroll hint ---------- */
  Array.prototype.slice.call(document.querySelectorAll("[data-goto]")).forEach(function (el) {
    el.addEventListener("click", function (e) {
      var i = Number(el.getAttribute("data-goto"));
      if (isNaN(i)) return;
      e.preventDefault();
      goTo(i);
    });
  });

  /* ---------- keep dots/nav in sync while scrolling (rAF-throttled) ---------- */
  var last = -1, ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var i = current();
      if (i !== last) { last = i; setActive(i); }
    });
  }
  deck.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- keep the active slide aligned across resizes ---------- */
  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () {
      deck.scrollLeft = (last < 0 ? 0 : last) * slideW();
    }, 120);
  });

  /* ---------- init ---------- */
  last = current();
  setActive(last);
})();

/* ---------- background switcher (nebula / black / lime), persists choice ----------
   The initial data-bg is set by an inline <head> script (no flash); this just
   wires the three swatches and keeps the active ring in sync. */
(function () {
  "use strict";
  var root = document.documentElement;
  var sws = Array.prototype.slice.call(document.querySelectorAll(".bgswitch__sw"));
  if (!sws.length) return;
  function sync() {
    var m = root.getAttribute("data-bg") || "nebula";
    sws.forEach(function (b) {
      var on = b.getAttribute("data-bg") === m;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-pressed", "true"); else b.removeAttribute("aria-pressed");
    });
  }
  sws.forEach(function (b) {
    b.addEventListener("click", function () {
      var m = b.getAttribute("data-bg");
      root.setAttribute("data-bg", m);
      try { localStorage.setItem("autosims-bg", m); } catch (e) {}
      sync();
    });
  });
  sync();
})();
