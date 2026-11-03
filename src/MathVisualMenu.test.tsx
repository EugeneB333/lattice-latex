// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MathVisualMenu } from "./MathVisualMenu";
import type { MathCommandOption } from "./mathCommands";
import { cleanupRoots, click, keydown, render } from "./test/render";

const { renderMath } = vi.hoisted(() => ({ renderMath: vi.fn() }));
vi.mock("katex", () => ({ default: { render: renderMath } }));

const commands: MathCommandOption[] = [
  { id: "vec", label: "\\vec{x}", title: "Vector", group: "Accents" },
  { id: "hat", label: "\\hat{x}", title: "Hat", group: "Accents" },
  { id: "overline", label: "\\overline{x}", title: "Overline" },
];
const roots: Array<{ unmount: () => void }> = [];

afterEach(() => {
  cleanupRoots(roots);
  renderMath.mockClear();
  document.body.innerHTML = "";
});

describe("MathVisualMenu", () => {
  it("renders a disabled, labelled trigger without opening a menu", () => {
    const view = render(<MathVisualMenu title="Accents" triggerLatex="x" commands={commands} disabled onInsert={vi.fn()} />);
    roots.push(view);
    const trigger = view.container.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Accents");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    click(trigger);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens in a portal, groups commands, and inserts the chosen command", () => {
    const onInsert = vi.fn();
    const view = render(<MathVisualMenu title="Accents" triggerLatex="x" commands={commands} disabled={false} onInsert={onInsert} />);
    roots.push(view);
    click(view.container.querySelector("button")!);

    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Accents");
    expect([...menu.querySelectorAll("h3")].map((item) => item.textContent)).toEqual(["Accents", "More"]);
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);

    click([...menu.querySelectorAll('[role="menuitem"]')].find((item) => item.getAttribute("title") === "Hat")!);
    expect(onInsert).toHaveBeenCalledWith("hat");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on an outside pointer press but not an inside press", () => {
    const view = render(<MathVisualMenu title="Accents" triggerLatex="x" commands={commands} disabled={false} onInsert={vi.fn()} />);
    roots.push(view);
    click(view.container.querySelector("button")!);
    const menu = document.querySelector('[role="menu"]')!;

    act(() => menu.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on Escape and restores focus to the trigger", () => {
    const view = render(<MathVisualMenu title="Accents" triggerLatex="x" commands={commands} disabled={false} onInsert={vi.fn()} />);
    roots.push(view);
    const trigger = view.container.querySelector("button") as HTMLButtonElement;
    click(trigger);
    keydown(window, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the palette within the viewport and moves it above a low trigger", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    const view = render(<MathVisualMenu title="Accents" triggerLatex="x" commands={commands} disabled={false} onInsert={vi.fn()} />);
    roots.push(view);
    const trigger = view.container.querySelector("button") as HTMLButtonElement;
    trigger.getBoundingClientRect = () => ({ left: 480, right: 500, top: 370, bottom: 390, width: 20, height: 20, x: 480, y: 370, toJSON: () => ({}) });
    click(trigger);
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.style.width).toBe("440px");
    expect(menu.style.left).toBe("52px");
    expect(menu.style.top).toBe("8px");
    expect(renderMath).toHaveBeenCalled();
  });
});
