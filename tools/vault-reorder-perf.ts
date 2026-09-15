import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerVaultIpcHandlers } from '../src/main/vault-ipc';
import { VaultRepository } from '../src/main/vault-repository';
import { newDocument } from '../src/shared/vault-format';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-reorder-perf-'));
  const userData = path.join(root, 'user-data');
  const vault = path.join(root, 'Vault');
  await fs.mkdir(userData); await fs.mkdir(vault);
  app.setPath('userData', userData);
  await app.whenReady();
  await VaultRepository.open(vault, true);
  for (let i = 0; i < 100; i++) {
    const name = `Doc_${String(i).padStart(3, '0')}`;
    await fs.writeFile(path.join(vault, `${name}.yantraD`), JSON.stringify(newDocument(name)));
  }
  for (let i = 0; i < 40; i++) {
    const folder = path.join(vault, `Folder_${String(i).padStart(3, '0')}`);
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'Nested.yantraD'), JSON.stringify(newDocument('Nested')));
  }
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
      if (args.path.endsWith('/vaultWorkspace.ts')) contents = contents.replace('  return store;', `window.__testStore = store; return store;`);
      return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' };
    });
  } }] });
  await fs.writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="app.css"><div id="root"></div><script>window.__renderCounts = {};</script><script src="app.js"></script>');
  const window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { preload: path.resolve('dist-electron/preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  async function waitFor(script: string) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(script)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timeout: ${script}`);
  }
  await window.loadFile(path.join(root, 'index.html'));
  await waitFor(`document.querySelectorAll('[data-path]').length === 140`);
  await evaluate(`window.__testStore.getState().openDocument('Doc_000.yantraD')`);
  await waitFor(`!!document.querySelector('[contenteditable=true]')`);
  await evaluate(`window.__renderCounts = {}; window.__busyChanges = 0; window.__testStore.subscribe((a,b) => { if (a.busy !== b.busy) window.__busyChanges++; }); void 0;`);
  const drag = (type: string, target: string, fraction = .05) => evaluate(`(() => { const row = document.querySelector('[data-path="${target}"]'); const r = row.getBoundingClientRect(); row.dispatchEvent(new DragEvent('${type}', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientY: r.top + r.height * ${fraction}, clientX: r.left + 20 })); })()`);
  await drag('dragstart', 'Folder_003');
  for (let i = 0; i < 10; i++) { await drag('dragover', `Folder_00${i % 2}`); await evaluate('new Promise(requestAnimationFrame)'); }
  const hover = await evaluate('window.__renderCounts');
  await evaluate('window.__renderCounts = {}');
  let reads = 0;
  const readFile = fs.readFile;
  // SAFETY: The wrapper forwards every argument and return value to the original overloaded readFile.
  fs.readFile = ((...args: Parameters<typeof fs.readFile>) => { if (String(args[0]).endsWith('.yantraD')) reads++; return readFile(...args); }) as typeof fs.readFile;
  const start = performance.now();
  await drag('drop', 'Folder_000');
  await waitFor(`!window.__testStore.getState().busy && document.querySelector('.vault-tree > ul > li > button')?.dataset.path === 'Folder_003'`);
  // Wait for metadata to commit, including optimistic implementations.
  await waitFor(`!document.querySelector('.vault-tree__row--dragging')`);
  for (let i = 0; i < 200; i++) {
    if (JSON.parse(await readFile(path.join(vault, '.yantra/vault.json'), 'utf8')).sidebarOrder?.indexOf('Folder_003') === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const result = { hover, drop: await evaluate('window.__renderCounts'), busyChanges: await evaluate('window.__busyChanges'), documentReads: reads, dropMs: Math.round(performance.now() - start) };
  fs.readFile = readFile;
  if (process.argv.includes('--assert')) {
    assert.equal(result.hover.newDocument ?? 0, 0, 'Toolbar rerendered during hover');
    assert.equal(result.busyChanges, 0, 'Reorder toggled global busy');
    assert.equal(result.documentReads, 0, 'Reorder scanned document content');
    assert.equal(result.drop.newDocument ?? 0, 0, 'Toolbar rerendered on drop');
    assert.equal(result.drop.panelLeft ?? 0, 0, 'Panel control rerendered on drop');
    assert.equal(result.drop.newFolder ?? 0, 0, 'Vault action rerendered on drop');
    assert.equal(result.drop.editor ?? 0, 0, 'Unrelated editor rerendered on drop');
    assert.ok((result.hover.icon ?? 0) <= 50, 'Hover rerendered unrelated rows');
  }
  console.log(JSON.stringify(result, null, 2));
  window.destroy(); app.exit(0);
}
void main().catch((error) => { console.error(error); app.exit(1); });
