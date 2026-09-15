import { app, BrowserWindow, shell } from 'electron';
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-deletion-perf-'));
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
  shell.trashItem = async (absolute) => { await fs.rename(absolute, path.join(root, 'trashed-' + path.basename(absolute))); };
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
  await evaluate(`window.__flow.getState().selectNode(window.__flow.getState().nodes[0].id)`);
  await settle();
  await reset();
  const readFile = fs.readFile;
  let documentReads = 0;
  // SAFETY: The wrapper forwards every argument and return value to the original overloaded fs.readFile.
  fs.readFile = ((...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]).endsWith('.yantraD')) documentReads++;
    return readFile(...args);
  }) as typeof fs.readFile;
  await evaluate(`window.__oldElements = new Map([...document.querySelectorAll('.react-flow__node')].map(el => [el.dataset.id, el]));
    window.__oldFlow = window.__flow;
    window.__activeChanges = [];
    window.__stopActive = window.__testStore.subscribe((a,b) => { if(a.activeCanvasId !== b.activeCanvasId) window.__activeChanges.push(a.activeCanvasId); });
    const original = window.__testStore.getState().deleteCanvasNodes;
    window.__testStore.setState({ deleteCanvasNodes: (...args) => (window.__deletion = original(...args)) });
    document.querySelector('.selection-toolbar__delete').click();`);
  assert.equal((await evaluate('window.__deletion')).status, 'success');
  await waitFor(`document.querySelectorAll('.react-flow__node').length === 29`);
  await settle();
  fs.readFile = readFile;
  const result = await metrics();
  const surviving = canvas.nodes.slice(1);
  const summarize = (counts: Record<string, number>) => ({ distinct: surviving.filter(n => counts[n.id]).length, total: surviving.reduce((sum,n)=>sum+(counts[n.id]??0),0) });
  const identity = await evaluate(`({ flowReplaced: window.__oldFlow !== window.__flow,
    activeChanges: window.__activeChanges,
    survivingDomReplaced: [...document.querySelectorAll('.react-flow__node')].filter(el => window.__oldElements.get(el.dataset.id) !== el).length })`);
  const measurement = { rows: result.rows, renders: result.renders, busyChanges: result.busyChanges,
    survivingWrappers: summarize(result.nodes), survivingMarkdown: summarize(result.markdown), documentReads, ...identity };
  console.log(JSON.stringify(measurement, null, 2));
  assert.equal(identity.flowReplaced, false);
  assert.equal(identity.survivingDomReplaced, 0);
  assert.equal(measurement.survivingWrappers.total, 0);
  assert.equal(measurement.survivingMarkdown.total, 0);
  assert.equal(result.rows.sample ?? 0, 0);
  assert.equal(result.rows.unrelatedFolder ?? 0, 0);
  assert.equal(result.busyChanges, 0);
  window.destroy();
  await fs.rm(root, { recursive: true, force: true });
  app.exit(0);
}
void main().catch((error) => { console.error(error); app.exit(1); });
