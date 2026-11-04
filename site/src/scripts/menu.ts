// Mobile menu of the navigation pill (design language of the Arcly family, D1 – the same pattern goes to the
// NoirPad and Dirwise sites). Below the navigation breakpoint the section links move into a panel opened by a
// button. Progressive enhancement: the button is `hidden` in the HTML and shown only here, so without JS
// nothing is offered that does not work. Accessibility: aria-expanded / aria-controls, focus moves into the
// panel and is trapped between the button and the links while it is open, Esc and a click outside close it and
// focus returns to the button. Motion: a 180 ms fade + 4 px drop with the family ease-out (CSS); with reduced
// motion the panel just appears (no transition), see site.css.

const BREAKPOINT = "(max-width: 760px)";

export function setupMenu(root: ParentNode = document) {
  const foundToggle = root.querySelector<HTMLButtonElement>(".nav-toggle");
  const foundPanel = root.querySelector<HTMLElement>("#nav-menu");
  if (!foundToggle || !foundPanel) return;
  const toggle: HTMLButtonElement = foundToggle;
  const panel: HTMLElement = foundPanel;
  const wrap = toggle.closest<HTMLElement>(".nav-wrap") ?? document.body;
  const mq = matchMedia(BREAKPOINT);
  const links = () => Array.from(panel.querySelectorAll<HTMLAnchorElement>("a[href]"));
  let open = false;
  let hideTimer = 0;

  const setOpen = (next: boolean, { returnFocus = true } = {}) => {
    if (next === open) return;
    open = next;
    toggle.setAttribute("aria-expanded", String(open));
    clearTimeout(hideTimer);
    if (open) {
      panel.hidden = false;
      // Next frame: the panel is in the layout, so the transition from the closed state runs.
      requestAnimationFrame(() => wrap.setAttribute("data-menu", "open"));
      links()[0]?.focus();
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onOutside);
    } else {
      wrap.removeAttribute("data-menu");
      // Remove from the accessibility tree once the closing transition (≤ 180 ms) is over.
      hideTimer = window.setTimeout(() => { if (!open) panel.hidden = true; }, 140);
      if (returnFocus && (panel.contains(document.activeElement) || document.activeElement === document.body)) toggle.focus();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    }
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    // Focus trap: the button and the links in the panel.
    const items: HTMLElement[] = [toggle, ...links()];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 || i === -1 ? 0 : i + 1;
    e.preventDefault();
    items[nextIndex].focus();
  }

  function onOutside(e: PointerEvent) {
    const t = e.target as Node;
    if (!panel.contains(t) && !toggle.contains(t)) setOpen(false, { returnFocus: false });
  }

  toggle.hidden = false;
  toggle.addEventListener("click", () => setOpen(!open));
  // A link was chosen: close (the anchor jump itself is native or handled by motion.ts).
  panel.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) setOpen(false, { returnFocus: false });
  });
  // Wider than the breakpoint the links are back in the pill – never leave the panel open there.
  // The button is hidden there too, so focus is not sent back to it.
  mq.addEventListener("change", () => { if (!mq.matches) setOpen(false, { returnFocus: false }); });
}
