import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { VaultRepository } from '../src/main/vault-repository';
import { registerVaultIpcHandlers } from '../src/main/vault-ipc';
import type { VaultTraceEvent } from '../src/shared/vault-trace';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-refactor-smoke-'));
  const userData = path.join(root, 'user-data');
  const vaultPath = path.join(root, 'PrivateVault');
  await fs.mkdir(userData);
  await fs.mkdir(vaultPath);
  app.setPath('userData', userData);
  await app.whenReady();
  app.on('window-all-closed', () => { /* Keep the server alive until assertions finish. */ });
  const repo = await VaultRepository.open(vaultPath, true);
  const created = await repo.createDocument('');
  await repo.renameEntry(created.path, 'PrivateHeading', 'PrivateHeading');
  await fs.writeFile(path.join(userData, 'vault-preferences.json'), JSON.stringify({ lastVault: vaultPath }));
  registerVaultIpcHandlers();
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  const window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: {
    preload: path.resolve('dist-electron/refactor-preload.cjs'), contextIsolation: true, nodeIntegration: false,
  } });
  const evaluate = (script: string) => window.webContents.executeJavaScript(script);
  async function waitFor(script: string) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await evaluate(script)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${script}\n${await evaluate('document.body.innerText')}`);
  }
  try {
    await window.loadURL(url);
    await waitFor(`!!document.querySelector('[data-path="PrivateHeading.yantraD"]')`);
    assert.equal(await evaluate('!!window.yantraDebug && !!window.yantraVaultTrace'), true);
    await evaluate('window.yantraDebug.clear()');
    await evaluate(`document.querySelector('[data-path="PrivateHeading.yantraD"]').click()`);
    await waitFor(`!!document.querySelector('[contenteditable=true]')`);
    await evaluate(`document.querySelector('[contenteditable=true]').focus()`);
    await window.webContents.insertText('42');
    for (const type of ['keyDown', 'char', 'keyUp'] as const) window.webContents.sendInputEvent({ type, keyCode: 'Enter' });
    await waitFor(`document.querySelector('.vault-workspace').getAttribute('aria-busy') === 'false' && !!document.querySelector('[aria-label="Saved"]') && document.querySelector('[data-path$=".yantraD"]').dataset.path !== 'PrivateHeading.yantraD'`);
    const events: VaultTraceEvent[] = await evaluate('window.yantraDebug.snapshot()');
    assert.ok(events.some((event) => event.event === 'title.workspace.finish' && event.outcome === 'success'));
    assert.ok(events.some((event) => event.event === 'vault:rename-entry.finish' && event.outcome === 'success'));
    const save = events.find((event) => event.event === 'save.start');
    assert.ok(save?.resource);
    assert.ok(events.some((event) => event.event === 'document.write.request' && event.resource === save.resource));
    const ipc = events.find((event) => event.event === 'vault:save-document.start');
    assert.ok(events.some((event) => event.event === 'filesystem.start' && event.operation === ipc?.operation));
    assert.ok(!JSON.stringify(events).includes('PrivateHeading'));
    assert.ok(!JSON.stringify(events).includes('PrivateVault'));
    await fs.writeFile(path.join(root, 'trace.json'), JSON.stringify(events, null, 2));
    await fs.writeFile(path.join(root, 'live.png'), (await window.webContents.capturePage()).toPNG());

    const before = await fs.readdir(vaultPath);
    await window.loadURL(`${url}?preview=vault-ui`);
    await waitFor(`!!document.querySelector('[aria-label="Preview state"]')`);
    await evaluate('window.yantraDebug.clear()');
    await evaluate(`document.querySelector('[aria-label="New Document"]').click()`);
    await evaluate(`document.querySelector('[aria-label="New Canvas"]').click()`);
    const states: string[] = await evaluate(`[...document.querySelector('[aria-label="Preview state"]').options].map(option => option.value)`);
    for (const state of states) {
      await evaluate(`(() => { const select = document.querySelector('[aria-label="Preview state"]'); select.value = ${JSON.stringify(state)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(await evaluate(`document.querySelector('[aria-label="Preview state"]').value`), state);
      if (state === 'Canvas - missing document') await waitFor(`document.querySelectorAll('.react-flow__edge-path').length === 2`);
    }
    assert.deepEqual(await fs.readdir(vaultPath), before);
    assert.deepEqual(await evaluate('window.yantraDebug.snapshot()'), []);
    for (const width of [1100, 640]) {
      window.setSize(width, 800);
      for (const state of ['Document', 'Canvas', 'Document - long title']) {
        await evaluate(`(() => { const select = document.querySelector('[aria-label="Preview state"]'); select.value = ${JSON.stringify(state)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const geometry = await evaluate(`(() => { const sidebar = document.querySelector('.app-shell__sidebar') || document.querySelector('[aria-label="Yantra sidebar"]'); const main = document.querySelector('.vault-preview-workspace'); const a = sidebar.getBoundingClientRect(), b = main.getBoundingClientRect(); return { sidebarRight: a.right, mainLeft: b.left, mainWidth: b.width }; })()`);
        assert.ok(geometry.mainWidth > 200);
        assert.ok(geometry.sidebarRight <= geometry.mainLeft + 1);
        await fs.writeFile(path.join(root, `preview-${state.replaceAll(' ', '-')}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    await evaluate('window.yantraDebug.clear()');
    assert.deepEqual(await evaluate('window.yantraDebug.snapshot()'), []);
    console.log(`Refactor diagnostics and preview smoke passed. Artifacts: ${root}`);
  } finally {
    window.destroy();
    await server.close();
  }
}

void main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
