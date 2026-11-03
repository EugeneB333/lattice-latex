import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

/** Complete typed script operators without changing paste, undo, or programmatic edits. */
export function registerScriptBraces(target: editor.IStandaloneCodeEditor, monaco: Monaco) {
  return target.onKeyDown((event) => {
    const key = event.browserEvent.key;
    if ((key !== "_" && key !== "^") || event.browserEvent.isComposing
      || event.ctrlKey || event.metaKey || event.altKey
      || target.getOption(monaco.editor.EditorOption.readOnly)) return;
    const model = target.getModel();
    const selections = target.getSelections();
    if (!model || model.getLanguageId() !== "latex" || !selections?.length) return;

    const edits = selections.map((range) => {
      const start = range.getStartPosition();
      const prefix = model.getLineContent(start.lineNumber).slice(0, start.column - 1);
      // Consume escaped characters in pairs, including escaped percent signs.
      const inComment = /^(?:[^\\%]|\\.)*%/.test(prefix);
      const escaped = (prefix.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
      const end = range.getEndPosition();
      const hasBrace = model.getLineContent(end.lineNumber)[end.column - 1] === "{";
      const complete = !inComment && !escaped && !hasBrace;
      return {
        range,
        text: complete ? `${key}{}` : key,
        forceMoveMarkers: true,
        offset: model.getOffsetAt(start),
        removed: model.getOffsetAt(end) - model.getOffsetAt(start),
        complete,
      };
    });
    if (!edits.some((edit) => edit.complete)) return;

    event.preventDefault();
    event.stopPropagation();
    target.pushUndoStop();
    target.executeEdits("lattice-script-braces", edits, () => edits.map((edit) => {
      const shift = edits.filter((other) => other.offset < edit.offset)
        .reduce((total, other) => total + other.text.length - other.removed, 0);
      const position = model.getPositionAt(edit.offset + shift + (edit.complete ? 2 : 1));
      return new monaco.Selection(position.lineNumber, position.column, position.lineNumber, position.column);
    }));
    target.pushUndoStop();
  });
}
