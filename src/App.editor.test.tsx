/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface CapturedEditorProps {
  defaultValue?: string;
  onChange?: (value: string | undefined) => void;
  value?: string;
}

const capturedEditor = vi.hoisted(() => ({ current: null as CapturedEditorProps | null }));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    default: (props: CapturedEditorProps) => {
      capturedEditor.current = props;
      return React.createElement("textarea", {
        "aria-label": "Mock Monaco editor",
        defaultValue: props.defaultValue,
      });
    },
  };
});

import App from "./App";

describe("Monaco source ownership", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    capturedEditor.current = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("never feeds delayed typing snapshots back as a controlled editor value", async () => {
    await act(async () => root.render(<App />));
    expect(capturedEditor.current).not.toBeNull();
    expect(capturedEditor.current).not.toHaveProperty("value");

    await act(async () => capturedEditor.current?.onChange?.("rapid typing in the middle"));
    expect(capturedEditor.current).not.toHaveProperty("value");

    await act(async () => vi.advanceTimersByTimeAsync(220));
    expect(capturedEditor.current?.defaultValue).toBe("rapid typing in the middle");
    expect(capturedEditor.current).not.toHaveProperty("value");
  });
});
