interface TextModel {
  getValue: () => string;
  setValue: (content: string) => void;
}

interface DocumentEditor {
  getModel: () => TextModel | null;
  setPosition: (position: { lineNumber: number; column: number }) => void;
}

/** Replace Monaco's model only at an explicit document boundary. */
export function loadEditorDocument(editor: DocumentEditor, content: string): boolean {
  const model = editor.getModel();
  if (!model || model.getValue() === content) return false;
  model.setValue(content);
  editor.setPosition({ lineNumber: 1, column: 1 });
  return true;
}
