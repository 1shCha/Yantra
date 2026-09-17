import type { Plugin } from 'vite';

// Explicit anchors fail closed when the instrumented components are refactored.
const targets = [
  ['vault-ui/VaultSidebar.tsx', "  const isFolder = entry.kind === 'folder';", "useRenderProbe('row', entry.resourceId ?? entry.id);"],
  ['vault-ui/VaultSidebar.tsx', '  const [dragging, setDragging]', "useRenderProbe('sidebar');"],
  ['vault/DocumentEditor.tsx', '  const { editor, titleError }', "useRenderProbe('document', file.id);"],
  ['vault/VaultDocumentNode.tsx', '  const isEditing = useCanvasState((state) => state.editingNodeId === props.id);', "useRenderProbe('canvas-node', documentId);"],
  ['canvas/CanvasView.tsx', '  const flowApi = useCanvasStoreApi();', "useRenderProbe('canvas-surface');"],
  ['vault-ui/VaultHeaderName.tsx', '  const [editing, setEditing]', "useRenderProbe('header', kind);"],
  ['vault/VaultTabBar.tsx', '  const Icon = tab.kind === \'canvas\' ? PanelsTopLeft : FileText;', "useRenderProbe('tab', tab.fileId);"],
  ['vault/VaultTabBar.tsx', '  const list = useRef<HTMLDivElement>(null);', "useRenderProbe('tab-bar');"],
];
export function uiRenderProbePlugin(): Plugin {
  return {
    name: 'ui-render-probe', enforce: 'pre',
    transform(code, id) {
      const matches = targets.filter(([file]) => id.endsWith(`/src/renderer/${file}`));
      if (!matches.length) return;
      for (const [, anchor, probe] of matches) {
        if (!code.includes(anchor!)) throw new Error(`Missing render probe anchor in ${id}: ${anchor}`);
        code = code.replace(anchor!, `  ${probe}\n${anchor}`);
      }
      return { code: `import { useRenderProbe } from '/tools/ui-render-probe';\n${code}`, map: null };
    },
  };
}
