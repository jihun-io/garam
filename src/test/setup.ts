import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import i18n from "../i18n";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

// jsdom has no layout engine. Virtualized lists measure their scroll
// container, so report a fixed size and a no-op ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix Select and the splitter use pointer capture, and Select scrolls the
// chosen item into view; jsdom implements neither.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
Object.defineProperties(HTMLElement.prototype, {
  clientHeight: { configurable: true, get: () => 600 },
  clientWidth: { configurable: true, get: () => 800 },
});
