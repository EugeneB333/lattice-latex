interface TextInsertionEditor<Range> {
  getModel: () => unknown | null;
  getSelection: () => Range | null;
  pushUndoStop: () => void;
  executeEdits: (source: string, edits: Array<{ range: Range; text: string; forceMoveMarkers: boolean }>) => void;
  focus: () => void;
}

/** Insert at Monaco's live selection as one isolated, undoable edit. */
export function insertEditorText<Range>(editor: TextInsertionEditor<Range>, text: string, source: string): boolean {
  if (!editor.getModel()) return false;
  const selection = editor.getSelection();
  if (!selection) return false;
  editor.pushUndoStop();
  editor.executeEdits(source, [{ range: selection, text, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  editor.focus();
  return true;
}
