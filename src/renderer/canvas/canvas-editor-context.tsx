import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';

interface CanvasEditorContextValue {
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
}

const CanvasEditorContext = createContext<CanvasEditorContextValue | null>(null);

export function CanvasEditorProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const value = useMemo(
    () => ({
      editor,
      setEditor,
    }),
    [editor],
  );

  return <CanvasEditorContext.Provider value={value}>{children}</CanvasEditorContext.Provider>;
}

export function useCanvasEditor(): CanvasEditorContextValue {
  const context = useContext(CanvasEditorContext);
  if (context === null) {
    throw new Error('useCanvasEditor must be used within CanvasEditorProvider');
  }

  return context;
}
