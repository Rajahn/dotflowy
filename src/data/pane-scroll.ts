/**
 * Who scrolls an outline (docs/workbench/PLAN.md 2.3).
 *
 * On a wide screen every workbench pane is its own scroll box: the pane root
 * carries `data-pane-scroll` and `overflow-y: auto`, so columns scroll
 * independently. On a narrow screen (< 768px, the ADR 0066 breakpoint) there
 * is only one column and the WINDOW scrolls, exactly as before -- the mobile
 * address-bar collapse, the keyboard viewport (use-keyboard-viewport.ts) and
 * the caret drawers all rely on page scrolling.
 *
 * Every helper takes the scroller from {@link scrollerOf}: an element, or
 * `null` for the window. Code that used to read `window.scrollY` or call
 * `window.scrollBy` goes through here so it works in both modes.
 */

/** The element that scrolls `el`'s pane, or null when the window does. */
export function scrollerOf(el: Element | null | undefined): HTMLElement | null {
  return el?.closest<HTMLElement>("[data-pane-scroll]") ?? null;
}

export function getScrollTop(scroller: HTMLElement | null): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

export function setScrollTop(scroller: HTMLElement | null, top: number): void {
  if (scroller) scroller.scrollTop = top;
  else window.scrollTo(0, top);
}

export function scrollByY(scroller: HTMLElement | null, dy: number): void {
  if (scroller) scroller.scrollBy(0, dy);
  else window.scrollBy(0, dy);
}

/**
 * The band of the viewport the scroller shows, in client coordinates: the
 * visual viewport for the window (a soft keyboard shrinks it), or the
 * scroller's box clipped to the visual viewport.
 */
export interface ScrollBand {
  top: number;
  height: number;
}

export function scrollViewport(scroller: HTMLElement | null): ScrollBand {
  const vvTop = window.visualViewport?.offsetTop ?? 0;
  const vvHeight = window.visualViewport?.height ?? window.innerHeight;
  if (!scroller) return { top: vvTop, height: vvHeight };
  const rect = scroller.getBoundingClientRect();
  const top = Math.max(rect.top, vvTop);
  const bottom = Math.min(rect.bottom, vvTop + vvHeight);
  return { top, height: Math.max(0, bottom - top) };
}

/** A client-space y converted to the scroller's content frame -- a value that
 *  stays put while the scroller scrolls (the document y, for the window). */
export function contentY(
  scroller: HTMLElement | null,
  clientY: number,
): number {
  return clientY - contentOrigin(scroller);
}

/** The client y of scroll-content y = 0 (the inverse of {@link contentY}):
 *  a content-space y plus this is a viewport y. */
export function contentOrigin(scroller: HTMLElement | null): number {
  if (!scroller) return -window.scrollY;
  return scroller.getBoundingClientRect().top - scroller.scrollTop;
}
