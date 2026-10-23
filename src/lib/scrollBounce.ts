// Radix layers (dialogs, menus, selects) lock the page's scrolling with
// react-remove-scroll while they are open. It listens for wheel and
// touchmove on `document`, non-passively, and cancels any event that would
// scroll a container past its edge. Both stop WebKit from rubber-banding
// the lists inside those layers: the cancelled event is the very gesture
// it turns into a bounce, and a non-passive listener makes it hand every
// wheel event to JavaScript before scrolling.
//
// The window itself never scrolls (`overscroll-behavior: none` on the root,
// `contain` on every scroll container in global.css), so the lock has
// nothing to protect. Wheel and touchmove listeners on `document` are made
// passive, and wheel events from inside an open layer stop at `body`, so
// the lock neither delays nor cancels them.

const LAYERS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  "[data-radix-popper-content-wrapper]",
  "[data-radix-select-viewport]",
].join(", ");

const SCROLL_EVENTS = new Set(["wheel", "touchmove"]);

/** Lets scroll containers in dialogs, menus and selects bounce at their edges. */
export function installLayerScrollBounce(doc: Document = document): () => void {
  const add = doc.addEventListener;
  doc.addEventListener = function (
    this: Document,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (SCROLL_EVENTS.has(type)) {
      const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
      const rest = typeof options === "object" ? options : {};
      options = { ...rest, capture, passive: true };
    }
    add.call(this, type, listener, options);
  } as Document["addEventListener"];

  const onWheel = (e: WheelEvent) => {
    if (e.target instanceof Element && e.target.closest(LAYERS)) e.stopPropagation();
  };
  doc.body.addEventListener("wheel", onWheel, { passive: true });
  return () => {
    doc.addEventListener = add;
    doc.body.removeEventListener("wheel", onWheel);
  };
}
