import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

export function click(element: Element, init: MouseEventInit = {}) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })));
}

export function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string | boolean) {
  act(() => {
    if (typeof value === "boolean" && element instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(element, value);
    } else {
      const prototype = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, String(value));
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function keydown(element: Element | Window, key: string, init: KeyboardEventInit = {}) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })));
}

export function cleanupRoots(roots: Array<{ unmount: () => void }>) {
  while (roots.length) roots.pop()?.unmount();
}
