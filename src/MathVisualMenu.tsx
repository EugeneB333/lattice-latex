import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MathCommandId, MathCommandOption } from "./mathCommands";

function MathPreview({ latex }: { latex: string }) {
  const previewRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!previewRef.current) return;
    katex.render(latex, previewRef.current, {
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  }, [latex]);
  return <span className="rendered-math" ref={previewRef} aria-hidden="true" />;
}

export function MathVisualMenu({
  title,
  triggerLatex,
  commands,
  disabled,
  onInsert,
}: {
  title: string;
  triggerLatex: string;
  commands: MathCommandOption[];
  disabled: boolean;
  onInsert: (command: MathCommandId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 420, maxHeight: 420 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const groups = Array.from(new Set(commands.map((command) => command.group ?? "More")));

  const placePalette = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = Math.min(440, window.innerWidth - margin * 2);
    const maxHeight = Math.min(460, window.innerHeight - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const roomBelow = window.innerHeight - rect.bottom - gap - margin;
    const top = roomBelow >= Math.min(330, maxHeight)
      ? rect.bottom + gap
      : Math.max(margin, rect.top - gap - maxHeight);
    setPosition({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePalette();
    window.addEventListener("resize", placePalette);
    window.addEventListener("scroll", placePalette, true);
    return () => {
      window.removeEventListener("resize", placePalette);
      window.removeEventListener("scroll", placePalette, true);
    };
  }, [open, placePalette]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !paletteRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="visual-math-menu-anchor">
      <button
        ref={triggerRef}
        type="button"
        className={`math-command-menu visual-math-menu-trigger ${disabled ? "disabled" : ""}`}
        disabled={disabled}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <MathPreview latex={triggerLatex} />
        <ChevronDown size={10} />
      </button>
      {open && createPortal(
        <div
          ref={paletteRef}
          className="visual-math-palette"
          role="menu"
          aria-label={title}
          style={position}
        >
          <header><MathPreview latex={triggerLatex} /><strong>{title}</strong><span>Choose a template</span></header>
          <div className="visual-math-palette-scroll">
            {groups.map((group) => (
              <section key={group}>
                <h3>{group}</h3>
                <div className="visual-math-grid">
                  {commands.filter((command) => (command.group ?? "More") === group).map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      role="menuitem"
                      title={command.title}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onInsert(command.id);
                        setOpen(false);
                      }}
                    >
                      <MathPreview latex={command.label} />
                      <span>{command.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
