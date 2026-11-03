// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, click, keydown, render } from "./test/render";
import { WorkspaceTabs } from "./WorkspaceTabs";

const roots: Array<{ unmount: () => void }> = [];
afterEach(() => cleanupRoots(roots));

describe("WorkspaceTabs", () => {
  it("exposes tab state, activates with pointer and keyboard, closes, and adds", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const onAdd = vi.fn();
    const view = render(
      <WorkspaceTabs
        ariaLabel="Open files"
        className="file-tabs"
        items={[
          { id: "one", label: "one.tex" },
          { id: "two", label: "two.tex", accessibleLabel: "two.tex (chapters/two.tex)", title: "chapters/two.tex", dirty: true },
        ]}
        activeId="one"
        addLabel="Open project"
        onActivate={onActivate}
        onClose={onClose}
        onAdd={onAdd}
      />,
    );
    roots.push(view);
    const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs[1].getAttribute("aria-label")).toBe("two.tex (chapters/two.tex)");
    expect(tabs[1].title).toBe("chapters/two.tex");
    expect(tabs[1].querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    click(tabs[1]);
    expect(onActivate).toHaveBeenCalledWith("two");
    keydown(tabs[0], "ArrowRight");
    expect(onActivate).toHaveBeenLastCalledWith("two");
    expect(document.activeElement).toBe(tabs[1]);
    keydown(tabs[1], "Home");
    expect(onActivate).toHaveBeenLastCalledWith("one");
    click(view.container.querySelector('[aria-label="Close two.tex (chapters/two.tex)"]')!);
    expect(onClose).toHaveBeenCalledWith("two");
    click(view.container.querySelector('[aria-label="Open project"]')!);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("does not offer closing when only one tab remains", () => {
    const view = render(
      <WorkspaceTabs
        ariaLabel="Open files"
        className="file-tabs"
        items={[{ id: "one", label: "one.tex" }]}
        activeId="one"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    roots.push(view);
    expect(view.container.querySelector('[aria-label^="Close "]')).toBeNull();
  });
});
