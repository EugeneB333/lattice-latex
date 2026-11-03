import { Plus, X } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

export interface WorkspaceTabItem {
  id: string;
  label: string;
  accessibleLabel?: string;
  title?: string;
  dirty?: boolean;
}

export function WorkspaceTabs({
  ariaLabel,
  items,
  activeId,
  className,
  addLabel,
  onActivate,
  onClose,
  onAdd,
}: {
  ariaLabel: string;
  items: WorkspaceTabItem[];
  activeId: string;
  className: string;
  addLabel?: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd?: () => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canClose = items.length > 1;
  const activateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    onActivate(items[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={`workspace-tabs ${className}`} role="tablist" aria-label={ariaLabel}>
      <div className="workspace-tab-scroll">
        {items.map((item, index) => (
          <div className={`workspace-tab-entry ${item.id === activeId ? "active" : ""}`} key={item.id}>
            <button
              type="button"
              ref={(element) => { tabRefs.current[index] = element; }}
              role="tab"
              aria-selected={item.id === activeId}
              aria-label={item.accessibleLabel}
              tabIndex={item.id === activeId ? 0 : -1}
              title={item.title ?? item.label}
              onClick={() => onActivate(item.id)}
              onKeyDown={(event) => activateFromKeyboard(event, index)}
            >
              <span>{item.label}</span>
              {item.dirty && <i className="dirty-dot" aria-label="Unsaved changes" />}
            </button>
            {canClose && (
              <button
                type="button"
                className="workspace-tab-close"
                aria-label={`Close ${item.accessibleLabel ?? item.label}`}
                title={`Close ${item.title ?? item.label}`}
                onClick={() => onClose(item.id)}
              ><X size={11} /></button>
            )}
          </div>
        ))}
      </div>
      {onAdd && (
        <button type="button" className="workspace-tab-add" aria-label={addLabel} title={addLabel} onClick={onAdd}>
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
