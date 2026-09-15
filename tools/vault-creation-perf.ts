import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerVaultIpcHandlers } from '../src/main/vault-ipc';
import { VaultRepository } from '../src/main/vault-repository';
import { newCanvas } from '../src/shared/vault-canvas';
import { randomUUID } from 'node:crypto';
import { newDocument } from '../src/shared/vault-format';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-creation-perf-'));
  const userData = path.join(root, 'user-data');
  const vault = path.join(root, 'Vault');
  await fs.mkdir(userData); await fs.mkdir(vault);
  app.setPath('userData', userData);
  await app.whenReady();
  await VaultRepository.open(vault, true);
  const canvas = newCanvas('Board');
  for (let i = 0; i < 100; i++) {
    const name = `Doc_${String(i).padStart(3, '0')}`;
    const document = newDocument(name);
    await fs.writeFile(path.join(vault, `${name}.yantraD`), JSON.stringify(document));
    if (i < 30) canvas.nodes.push({ id: randomUUID(), kind: 'document', documentId: document.id, x: (i % 5) * 350, y: Math.floor(i / 5) * 250, width: 320, height: 220 });
  }
  for (let i = 0; i < 40; i++) {
    const folder = path.join(vault, `Folder_${String(i).padStart(3, '0')}`);
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'Nested.yantraD'), JSON.stringify(newDocument('Nested')));
  }
  canvas.layerOrder = canvas.nodes.map((node) => node.id);
  canvas.viewport = { x: 0, y: 0, zoom: .4 };
  await fs.writeFile(path.join(vault, 'Board.yantraC'), JSON.stringify(canvas));
  await fs.mkdir(path.join(vault, 'Unfiled'));
  await fs.writeFile(path.join(userData, 'vault-preferences.json'), JSON.stringify({ lastVault: vault }));
  registerVaultIpcHandlers();
  await build({ stdin: { contents: `import { createRoot } from 'react-dom/client'; import { VaultApp } from './src/renderer/vault/VaultApp'; import './src/renderer/styles.css'; createRoot(document.getElementById('root')).render(<VaultApp />);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, loader: { '.svg': 'dataurl' }, outfile: path.join(root, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', __VAULT_DIAGNOSTICS__: 'false' }, plugins: [{ name: 'render-counts', setup(builder) {
    builder.onLoad({ filter: /\.(tsx|ts)$/ }, async (args) => {
      let contents = await fs.readFile(args.path, 'utf8');
      const count = (label: string) => `window.__renderCounts[${JSON.stringify(label)}] = (window.__renderCounts[${JSON.stringify(label)}] || 0) + 1;`;
      if (args.path.endsWith('/SidebarIcon.tsx')) contents = contents.replace('  return <svg', `${count('icon')} window.__renderCounts[kind] = (window.__renderCounts[kind] || 0) + 1; return <svg`);
      if (args.path.endsWith('/VaultSidebar.tsx')) contents = contents.replace('function VaultSidebar(props: VaultSidebarProps) {', `function VaultSidebar(props: VaultSidebarProps) { ${count('sidebar')}`);
      if (args.path.endsWith('/VaultViewport.tsx')) contents = contents.replace('  const state = useStore', `${count('viewport')} const state = useStore`);
      if (args.path.endsWith('/DocumentEditor.tsx')) contents = contents.replace('  const { editor, titleError }', `${count('editor')} const { editor, titleError }`);
      if (args.path.endsWith('/VaultSidebar.tsx')) contents = contents.replace("  const isFolder = entry.kind === 'folder';", `window.__rowCounts[entry.id] = (window.__rowCounts[entry.id] || 0) + 1; const isFolder = entry.kind === 'folder';`);
      if (args.path.endsWith('/VaultCanvasView.tsx')) contents = contents.replace('  const context = useContext', `window.__nodeCounts[props.id] = (window.__nodeCounts[props.id] || 0) + 1; const context = useContext`);
      if (args.path.endsWith('/MarkdownNode.tsx')) contents = contents.replace('  const doc = data.doc', `window.__markdownCounts[id] = (window.__markdownCounts[id] || 0) + 1; const doc = data.doc`);
      if (args.path.endsWith('/CanvasView.tsx')) contents = contents.replace('  const canvasRef =', `${count('canvasSurface')} const canvasRef =`);
      if (args.path.endsWith('/vault-canvas-session.ts')) contents = contents.replace('  return {\n    flow,', `window.__flow = flow; return {\n    flow,`);
      if (args.path.endsWith('/vaultWorkspace.ts')) contents = contents.replace('  return store;', `window.__testStore = store; return store;`);
      return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' };
    });
  } }] });
  await fs.writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="app.css"><div id="root"></div><script>window.__renderCounts = {}; window.__rowCounts = {}; window.__nodeCounts = {}; window.__markdownCounts = {};</script><script src="app.js"></script>');
  const window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { preload: path.resolve('dist-electron/preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('console-message', (details) => { if (details.level === 'error') console.error(details.message); });
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  async function waitFor(script: string) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(script)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timeout: ${script}`);
  }
  await window.loadFile(path.join(root, 'index.html'));
  await waitFor(`document.querySelectorAll('[data-path]').length === 142`);
  await evaluate(`document.querySelector('[data-path="Folder_000"]').click(); document.querySelector('[data-path="Folder_001"]').click(); document.querySelector('[data-path="Unfiled"]').click();`);
  const settle = () => evaluate(`(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); })()`);
  await evaluate(`window.__testStore.getState().openCanvas('Board.yantraC')`);
  await waitFor(`document.querySelectorAll('.react-flow__node').length === 30`);
  await settle();
  assert.equal(await evaluate(`Object.keys(window.__nodeCounts).length`), 30);
  async function reset() {
    await evaluate(`window.__renderCounts = {}; window.__rowCounts = {}; window.__nodeCounts = {}; window.__markdownCounts = {}; window.__busyChanges = 0;
      window.__references = [];
      window.__stopMetrics?.(); window.__stopFlowMetrics?.();
      window.__stopMetrics = window.__testStore.subscribe((a,b) => { if (a.busy !== b.busy) window.__busyChanges++; });
      window.__stopFlowMetrics = window.__flow.subscribe((a,b) => {
        if (a.nodes !== b.nodes) window.__references.push({ existingNodes: b.nodes.length, changed: b.nodes.filter(n => a.nodes.find(m => m.id === n.id) !== n).length, edgesChanged: a.edges !== b.edges });
      }); void 0;`);
  }
  async function metrics() {
    return evaluate(`({ renders: window.__renderCounts, busyChanges: window.__busyChanges,
      rows: { total: Object.values(window.__rowCounts).reduce((a,b)=>a+b,0), distinct: Object.keys(window.__rowCounts).length, sample: window.__rowCounts['Doc_010.yantraD'], unrelatedFolder: window.__rowCounts['Folder_001'] },
      nodes: window.__nodeCounts, markdown: window.__markdownCounts, references: window.__references })`);
  }
  await reset();
  const created = await evaluate(`window.__testStore.getState().createCanvasNode(window.__testStore.getState().activeCanvasId, { x: 1500, y: 1800 })`);
  assert.equal(created.status, 'success');
  await waitFor(`document.querySelectorAll('.react-flow__node').length === 31`);
  await settle();
  const nodeCreation = await metrics();
  const selectedId = await evaluate('window.__flow.getState().selectedNodeIds[0]');
  await reset();
  await evaluate(`window.__testStore.getState().createCanvasNode(window.__testStore.getState().activeCanvasId, { x: 1900, y: 1800 })`);
  await waitFor(`document.querySelectorAll('.react-flow__node').length === 32`);
  await settle();
  const selectedNodeCreation = await metrics();
  assert.ok(selectedNodeCreation.nodes[selectedId] > 0, 'Previously selected node must update');
  assert.notEqual(await evaluate('window.__flow.getState().selectedNodeIds[0]'), selectedId);
  await reset();
  await evaluate(`document.querySelector('[aria-label="New Document"]').click()`);
  await waitFor(`window.__testStore.getState().activeDocumentId && !window.__testStore.getState().busy`);
  await settle();
  const documentCreation = await metrics();
  const summarize = (counts: Record<string, number>) => ({ distinct: Object.keys(counts).length, total: Object.values(counts).reduce((a,b)=>a+b,0), existing: canvas.nodes.map(n => counts[n.id] ?? 0) });
  for (const measurement of [nodeCreation, selectedNodeCreation, documentCreation]) {
    assert.equal(measurement.busyChanges, 0, 'Creation toggled global busy');
    assert.equal(measurement.rows.sample ?? 0, 0, 'Unchanged document row rerendered');
    assert.equal(measurement.rows.unrelatedFolder ?? 0, 0, 'Unrelated folder rerendered');
    for (const node of canvas.nodes) {
      assert.equal(measurement.nodes[node.id] ?? 0, 0, 'Existing node wrapper rerendered');
      assert.equal(measurement.markdown[node.id] ?? 0, 0, 'Existing Markdown body rerendered');
    }
    assert.equal(measurement.renders.newDocument ?? 0, 0, 'Creation rerendered the action toolbar');
  }
  console.log(JSON.stringify({ mode: process.argv.slice(2),
    nodeCreation: { ...nodeCreation, nodes: summarize(nodeCreation.nodes), markdown: summarize(nodeCreation.markdown) },
    selectedNodeCreation: { ...selectedNodeCreation, nodes: summarize(selectedNodeCreation.nodes), markdown: summarize(selectedNodeCreation.markdown) },
    documentCreation: { ...documentCreation, nodes: summarize(documentCreation.nodes), markdown: summarize(documentCreation.markdown) } }, null, 2));
  window.destroy(); app.exit(0);
}
void main().catch((error) => { console.error(error); app.exit(1); });
