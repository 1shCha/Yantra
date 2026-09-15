import { editorDriver } from './test-support/editor-driver';
import { once } from 'node:events';
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerVaultIpcHandlers } from '../src/main/vault-ipc';
import { VaultRepository } from '../src/main/vault-repository';

import { createWindow } from '../src/main/window';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-workspace-'));
  const userData = path.join(root, 'user-data');
  const vault = path.join(root, 'Workspace vault');
  await fs.mkdir(userData); await fs.mkdir(vault);
  app.setPath('userData', userData);
  await app.whenReady();
  const repo = await VaultRepository.open(vault, true);
  const file = await repo.createDocument('');
  await repo.saveDocument({ ...file.document, doc: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' },
  ] } });
  const canvas = await repo.createCanvas('');
  const nodeId = crypto.randomUUID();
  await repo.saveCanvas({ ...canvas.canvas, nodes: [{ id: nodeId, kind: 'document', documentId: file.document.id, x: 80, y: 80, width: 400, height: 300 }], layerOrder: [nodeId] });
  await fs.writeFile(path.join(userData, 'vault-preferences.json'), JSON.stringify({ lastVault: vault }));
  registerVaultIpcHandlers();
  delete process.env.YANTRA_DEV_SERVER;
  createWindow();
  const win = BrowserWindow.getAllWindows()[0]!;
  await once(win.webContents, 'did-finish-load');
  assert.ok(win.webContents.getURL().startsWith('file:'), 'Normal startup must load the built renderer');
  const { evaluate, wait, click, edit } = editorDriver(win);
  await wait(`!!document.querySelector('[data-path="${canvas.path}"]')`);
  await click(canvas.path);
  await wait(`!!document.querySelector('.markdown-node__body')`);
  await evaluate(`document.querySelector('.markdown-node__body').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await wait(`!!document.querySelector('[contenteditable=true]')`);
  await edit(`editor.commands.setContent({type:'doc',content:[{type:'heading',attrs:{level:1}},...Array.from({length:40},(_,i)=>({type:'paragraph',content:[{type:'text',text:'Long paragraph '+i}]}))]});`);
  await edit(`editor.commands.focus();`);
  const before = await evaluate(`document.activeElement?.outerHTML.slice(0,120)`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await new Promise(r=>setTimeout(r,100));
  assert.notEqual(await evaluate(`document.activeElement?.outerHTML.slice(0,120)`), before, 'Tab must move focus out of the editor');
  await evaluate(`localStorage.setItem('yantra:sidebar-width:right','1000')`);
  await win.reload();
  await wait(`!!document.querySelector('[aria-label="Open right sidebar"]')`);
  win.setSize(900,620);
  await click('Open right sidebar');
  await new Promise(r=>setTimeout(r,400));
  assert.ok(await evaluate(`document.querySelector('.app-shell__surface').getBoundingClientRect().width >= 320`), 'Restored sidebar must leave room for the surface');
  win.setSize(1100, 700);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(await evaluate(`document.querySelector('.app-shell__surface').getBoundingClientRect().width >= 320`), 'Resizing must keep the surface usable');
  console.log('Workspace UI smoke passed: built startup, native Tab focus, restored sidebar widths and resizing.');
  win.destroy();
  await fs.rm(root, { recursive: true, force: true });
  app.quit();
}
main().catch(error=>{console.error(error);app.exit(1)});
