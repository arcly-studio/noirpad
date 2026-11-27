// Motion layer of the website: GSAP (ScrollTrigger) + Lenis (smooth scrolling) – structure and behaviour
// of the Dirwise site (Dirwise/site/src/scripts/motion.ts), including its fix that a block seen on mobile is
// never hidden again. Layout.astro loads it only in JS (desktop at once, mobile after `load`), so without JS,
// on an error or with "reduce motion" everything is visible. Initial hidden states are held by CSS only under
// `html[data-motion="pending"]` (site.css); here they become GSAP inline styles and the attribute turns "on".
// The hero text is never hidden: the typed line is clipped, not removed, and starts from the full text in HTML.
// Rules (design language of the Arcly family): only transform, opacity and clip; each block appears once (except
// scrub effects); entrances 0.6 s with a strong ease-out (power4.out = cubic-bezier(.23,1,.32,1)), offset 24 px (cards
// 32 px), scale from 0.97, stagger 0.06 s; scroll-linked effects follow Lenis directly (scrub: true – one smoothing,
// not two). Text pages are not animated – reading comes first. The navigation stays put.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

/*! Bundled third-party code:
 * GSAP 3.15.0 (gsap, ScrollTrigger) – Copyright 2008-2026, GreenSock. All rights reserved.
 *   Subject to the terms at https://gsap.com/standard-license
 * Lenis 1.3.27 – Copyright (c) 2024 darkroom.engineering – MIT License
 *   https://github.com/darkroomengineering/lenis/blob/main/LICENSE
 */
gsap.registerPlugin(ScrollTrigger);

const html = document.documentElement;
/** Strong ease-out of the family design language: power4.out ≈ cubic-bezier(.23,1,.32,1). */
const EASE = "power4.out";
/** From 768 px full motion (hero typing, parallax, Lenis); below it only a gentle reveal of sections. */
const DESKTOP = "(min-width: 768px)";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/** Blocks revealed on scroll: `data-reveal` on the home page and its footer; text pages (.doc) stay still. */
const REVEAL = "[data-reveal], main:not(.doc) ~ .foot";

let mm: gsap.MatchMedia | null = null;
let introDone = false;
let lenis: Lenis | null = null;

/** Undo everything (GSAP inline styles, Lenis) and show the content without motion – on any error. */
export function abort() {
  try {
    mm?.revert();
  } catch {
    /* revert failed itself – at least drop the attribute below */
  }
  mm = null;
  html.removeAttribute("data-motion");
}

export function init() {
  // The fallback in Layout.astro already removed the attribute (slow network) or "reduce motion" applies.
  if (html.dataset.motion !== "pending" || html.dataset.motionInit) return;
  html.dataset.motionInit = "1";

  try {
    mm = gsap.matchMedia();
    mm.add(
      { desktop: DESKTOP, mobile: "not all and (min-width: 768px)", fine: "(hover: hover) and (pointer: fine)", reduce: "(prefers-reduced-motion: reduce)" },
      (ctx) => {
        const { desktop, fine, reduce } = ctx.conditions as Record<string, boolean>;
        if (reduce) {
          html.removeAttribute("data-motion");
          return;
        }
        const ac = new AbortController();
        const signal = ac.signal;
        let ro: ResizeObserver | null = null;
        try {
          // On mobile the module loads after an interaction – hide only what is still below the window.
          const unseen = (el: Element) => desktop || el.getBoundingClientRect().top > innerHeight;
          const pending = $$(REVEAL).filter((el) => !el.dataset.revealed);
          // What the visitor has already seen counts as revealed – a later switch to desktop (rotated tablet,
          // wider window) must not hide it again (the fix from Dirwise phase 5).
          for (const el of pending) if (!unseen(el)) el.dataset.revealed = "1";
          const revealTargets = pending.filter((el) => !el.dataset.revealed);
          if (revealTargets.length) gsap.set(revealTargets, { opacity: 0, y: (_: number, el: Element) => revealY(el), scale: (_: number, el: Element) => (isCard(el) ? 0.97 : 1) });
          // The typing intro only on the first view at the top – not after scrolling or with an anchor in the URL.
          const intro = desktop && !introDone && scrollY < 50 && !targetOf(location.hash);
          introDone = true;
          html.dataset.motion = "on";

          if (desktop) {
            if (fine) lenis = setupLenis();
            if (intro) typeHero();
            // With Lenis the scroll is already smoothed – follow it directly; without it (touch) a light lag.
            const scrub = lenis ? true : 0.3;
            heroBackdrop(intro, scrub);
            shotTilt(scrub);
            cardsParallax();
            videoScale(scrub);
          }
          reveals(revealTargets, signal);
          keyCaps(unseen);
          anchors(signal);
          ro = refreshOnResize();
        } catch (err) {
          queueMicrotask(abort);
          console.error(err);
        }

        return () => {
          ac.abort();
          ro?.disconnect();
          if (ro) clearTimeout(refreshTimer);
          lenis?.destroy();
          lenis = null;
          html.classList.remove("lenis", "lenis-smooth", "lenis-scrolling", "lenis-stopped");
        };
      },
    );
  } catch (err) {
    abort();
    console.error(err);
  }
}

/* ---------- Lenis ---------- */

function setupLenis() {
  const l = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
  l.on("scroll", ScrollTrigger.update);
  const tick = (time: number) => l.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  const origDestroy = l.destroy.bind(l);
  l.destroy = () => {
    gsap.ticker.remove(tick);
    gsap.ticker.lagSmoothing(500, 33); // GSAP defaults
    origDestroy();
  };
  return l;
}

const targetOf = (hash: string) => {
  try {
    const id = decodeURIComponent(hash.slice(1));
    return id ? document.getElementById(id) : null;
  } catch {
    return null;
  }
};

/** Menu anchors and "Skip to content": smooth with Lenis, focus on the target as with the native jump.
 *  The offset below the navigation comes only from `scroll-margin-top` in site.css (Lenis honours it). */
function anchors(signal: AbortSignal) {
  document.addEventListener(
    "click",
    (e) => {
      if (!lenis || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[href*="#"]');
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      const el = targetOf(url.hash);
      if (!el) return;
      e.preventDefault();
      if (url.hash !== location.hash) history.pushState(null, "", url.hash);
      if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
      el.focus({ preventScroll: true });
      lenis.scrollTo(el, { duration: 0.8 });
    },
    { signal },
  );
}

/* ---------- Hero ---------- */

/** The decorative command line is "typed" character by character: --n goes 0 → --len in steps (CSS clips
 *  the rest, 1 ch per character), the second line follows. Ends in the same state as the HTML. */
function typeHero() {
  const lines = $$(".typed-line");
  if (!lines.length) return;
  const tl = gsap.timeline({ delay: 0.35 });
  lines.forEach((line, i) => {
    const len = Number(getComputedStyle(line).getPropertyValue("--len")) || 0;
    if (!len) return;
    gsap.set(line, { "--n": 0 });
    tl.to(line, { "--n": len, duration: Math.min(1.1, len * 0.045), ease: `steps(${len})` }, i === 0 ? 0 : "+=0.3");
  });
  tl.eventCallback("onComplete", () => gsap.set(lines, { clearProps: "--n" }));
}

/** The green glow behind the hero lights up on load and dims and sinks slower than the content on scroll. */
function heroBackdrop(intro: boolean, scrub: true | number) {
  // Two elements, as on the Dirwise site (sky + glow): the intro animates the inner glow, the scrub the
  // wrapper – the two tweens never fight over the same opacity.
  const wrap = $(".hero-glow-wrap");
  const glow = $(".hero-glow");
  if (!wrap || !glow) return;
  if (intro) gsap.fromTo(glow, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.9, ease: EASE, clearProps: "opacity,transform" });
  gsap.to(wrap, { y: 140, opacity: 0.35, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub } });
}

/** The big screenshot: a slight 3D tilt that straightens and grows while scrolling (scrub). It is visible
 *  from the first paint (no opacity), so it never delays the largest paint. The perspective is set only here
 *  (not also in CSS – applied twice it widened the frame past the window on medium screens). */
function shotTilt(scrub: true | number) {
  const shot = $(".hero-shot");
  const frame = $(".shot-frame");
  if (!shot || !frame) return;
  gsap.fromTo(
    frame,
    { rotateX: 12, scale: 0.94, transformPerspective: 1600, transformOrigin: "50% 0%" },
    { rotateX: 0, scale: 1, transformPerspective: 1600, ease: "none", scrollTrigger: { trigger: shot, start: 0, end: "center center", scrub } },
  );
}

/* ---------- Sections ---------- */

const isCard = (el: Element) => el.classList.contains("card");
/** Cards move up 32 px, other blocks 24 px, the footer only fades (a shift would lengthen a short page – CLS). */
const revealY = (el: Element) => (isCard(el) ? 32 : el.classList.contains("foot") ? 0 : 24);

const show = (els: HTMLElement[], stagger = 0.06) => {
  for (const el of els) el.dataset.revealed = "1";
  gsap.to(els, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: EASE, stagger, overwrite: "auto", clearProps: "opacity,transform" });
};

/** Reveal on scroll – once, in batches with a stagger. A block focused by keyboard before the scroll
 *  reveals it (Tab near the bottom edge) is shown at once. */
function reveals(targets: HTMLElement[], signal: AbortSignal) {
  if (!targets.length) return;
  for (const group of [targets.filter(isCard), targets.filter((el) => !isCard(el))]) {
    if (!group.length) continue;
    ScrollTrigger.batch(group, {
      start: "top 90%",
      once: true,
      onEnter: (batch) => {
        const rest = (batch as HTMLElement[]).filter((el) => el.dataset.revealed !== "1");
        if (rest.length) show(rest);
      },
    });
  }
  document.addEventListener(
    "focusin",
    (e) => {
      const el = (e.target as Element).closest<HTMLElement>(REVEAL);
      if (el && el.dataset.revealed !== "1" && targets.includes(el)) show([el], 0);
    },
    { signal },
  );
}

/** Key caps in the shortcuts section settle like pressed keys – once, together with their card; a small
 *  overshoot from 0.8, never from far smaller (design language: nothing appears from nothing). */
function keyCaps(unseen: (el: Element) => boolean) {
  const cards = $$(".keys li").filter((li) => !li.dataset.keysDone && !li.dataset.revealed && unseen(li));
  for (const li of cards) {
    const caps = $$("kbd", li);
    if (!caps.length) continue;
    gsap.set(caps, { scale: 0.8, y: -6 });
    ScrollTrigger.create({
      trigger: li,
      start: "top 90%",
      once: true,
      onEnter: () => {
        li.dataset.keysDone = "1";
        gsap.to(caps, { scale: 1, y: 0, duration: 0.4, ease: "back.out(1.7)", stagger: 0.06, delay: 0.1, clearProps: "transform" });
      },
    });
  }
}

/** Screenshots in the feature cards: parallax ±24 px (scrub). The pictures are zoomed (Home.astro) and
 *  overflow the frame, scale 1.08 adds a margin so no edge shows. */
function cardsParallax() {
  for (const card of $$(".bento .card")) {
    const pic = $(".card-shot picture", card);
    if (!pic) continue;
    gsap.fromTo(pic, { y: -24, scale: 1.08 }, { y: 24, scale: 1.08, ease: "none", scrollTrigger: { trigger: card, start: "top bottom", end: "bottom top", scrub: true } });
  }
}

/** Demo video: the frame grows from 0.85 to full size as it enters (scrub). */
function videoScale(scrub: true | number) {
  const frame = $(".video .frame");
  if (!frame) return;
  gsap.fromTo(frame, { scale: 0.85 }, { scale: 1, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "top 25%", scrub } });
}

/* ---------- Details ---------- */

/** The page height changes without a window resize (FAQ <details>, the video poster) – refresh the
 *  ScrollTriggers (trigger positions). */
let refreshTimer = 0;
function refreshOnResize() {
  if (!("ResizeObserver" in window)) return null;
  let last = document.body.offsetHeight;
  const ro = new ResizeObserver(() => {
    const h = document.body.offsetHeight;
    if (h === last) return;
    last = h;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 200);
  });
  ro.observe(document.body);
  return ro;
}
