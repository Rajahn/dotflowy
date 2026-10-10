/**
 * Carry the caret across an editor remount that keeps the same view: a pane's
 * editor is keyed by its scroll mode (the virtualizer's scroll source is fixed
 * at mount), so a viewport crossing 768px -- a tablet rotating, a window
 * resized -- remounts it. The leaving editor records the focused row and caret
 * offset; the next editor mounted in that pane takes the record, and restores
 * it only when it shows the same root. Any other mount discards it, so a zoom
 * never inherits a stale caret.
 */
export interface CarriedFocus {
  rootId: string | null;
  key: string;
  offset: number;
}

const carried = new Map<string, CarriedFocus>();

export function carryFocus(paneId: string, focus: CarriedFocus): void {
  carried.set(paneId, focus);
}

/** Take `paneId`'s carried focus if it was recorded for `rootId`. */
export function takeCarriedFocus(
  paneId: string,
  rootId: string | null,
): CarriedFocus | null {
  const focus = carried.get(paneId) ?? null;
  carried.delete(paneId);
  return focus && focus.rootId === rootId ? focus : null;
}
