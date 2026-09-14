import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { VAULT_CHANNELS } from '../shared/vault-api';
import { documentFileSchema, type VaultSnapshot } from '../shared/vault-format';
import { captureOperation, cancelled, OperationError, success, type OperationResult } from '../shared/operation-result';
import { canvasFileSchema } from '../shared/vault-canvas';
import { atomicWrite } from './atomic-write';
import { VaultRepository } from './vault-repository';
import { vaultTrace, vaultTraceOperation } from './vault-diagnostics';
import { VAULT_TRACE_CHANNEL } from '../shared/vault-trace';

const preferenceSchema = z.object({ lastVault: z.string() }).strict();

function handle<Args extends unknown[], T>(channel: string,
  work: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<T>, classify?: (value: T) => OperationResult<T>) {
  ipcMain.handle(channel, async (event, ...args: Args) => {
    const operation = vaultTrace.next();
    vaultTrace.record(`${channel}.start`, { operation });
    const run = () => captureOperation(() => work(event, ...args), classify);
    const outcome = await (vaultTrace.enabled ? vaultTraceOperation.run(operation, run) : run());
    vaultTrace.record(`${channel}.finish`, { operation, outcome: outcome.status,
      code: outcome.status === 'failure' || outcome.status === 'recovery-required' ? outcome.error.code : undefined });
    return outcome;
  });
}

function snapshotResult<T extends VaultSnapshot | null>(value: T): OperationResult<T> {
  return value?.recovery ? { status: 'recovery-required', value,
    error: { code: 'recovery-required', ...value.recovery } } : success(value);
}

export function registerVaultIpcHandlers(): void {
  if (vaultTrace.enabled && !app.isPackaged) ipcMain.handle(VAULT_TRACE_CHANNEL, (_event, clear = false) => {
    if (z.boolean().parse(clear)) vaultTrace.clear();
    return vaultTrace.snapshot();
  });
  let repository: VaultRepository | null = null;
  let choosing = false;
  const preferencesPath = () => path.join(app.getPath('userData'), 'vault-preferences.json');
  const active = (sessionId: string) => {
    if (!repository || repository.sessionId !== sessionId) throw new OperationError({ code: 'invalid-session', message: 'This vault session is no longer active.' });
    return repository;
  };

  handle(VAULT_CHANNELS.RESTORE, async () => {
    if (repository) return repository.scan();
    let text: string;
    try {
      text = await fs.readFile(preferencesPath(), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
    const { lastVault } = preferenceSchema.parse(JSON.parse(text));
    const restored = await VaultRepository.open(lastVault, false, (absolute) => shell.trashItem(absolute));
    const snapshot = await restored.scan();
    repository = restored;
    return snapshot;
  }, snapshotResult);

  handle(VAULT_CHANNELS.CHOOSE, async (event, input: boolean) => {
    const create = z.boolean().parse(input);
    if (choosing) throw new OperationError({ code: 'busy', message: 'A vault picker is already open.' });
    choosing = true;
    try {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) throw new Error('No workspace window is available.');
      const result = await dialog.showOpenDialog(owner, {
        title: create ? 'Create Yantra Vault in Folder' : 'Open Yantra Vault',
        properties: ['openDirectory', 'createDirectory'],
      });
      const root = result.filePaths[0];
      if (result.canceled || !root) return null;
      const chosen = await VaultRepository.open(root, create, (absolute) => shell.trashItem(absolute));
      const snapshot = await chosen.scan();
      await atomicWrite(preferencesPath(), `${JSON.stringify({ lastVault: chosen.root }, null, 2)}\n`);
      repository = chosen;
      return snapshot;
    } finally {
      choosing = false;
    }
  }, (value) => value === null ? cancelled('user') : snapshotResult(value));

  handle(VAULT_CHANNELS.READ_DOCUMENT, (_event, sessionId: string, relative: string, mode: 'inspect' | 'accept-disk' = 'inspect') =>
    active(z.string().parse(sessionId)).readDocument(z.string().parse(relative), z.enum(['inspect', 'accept-disk']).parse(mode)));
  handle(VAULT_CHANNELS.CREATE_DOCUMENT, (_event, sessionId: string, folder: string) =>
    active(z.string().parse(sessionId)).createDocument(z.string().parse(folder)));
  handle(VAULT_CHANNELS.SAVE_DOCUMENT, (_event, sessionId: string, input: z.input<typeof documentFileSchema>, overwrite = false) =>
    active(z.string().parse(sessionId)).saveDocument(documentFileSchema.parse(input), z.boolean().parse(overwrite)));
  handle(VAULT_CHANNELS.READ_CANVAS, (_event, sessionId: string, relative: string, mode: 'inspect' | 'accept-disk' = 'inspect') =>
    active(z.string().parse(sessionId)).readCanvas(z.string().parse(relative), z.enum(['inspect', 'accept-disk']).parse(mode)));
  handle(VAULT_CHANNELS.CREATE_CANVAS, (_event, sessionId: string, folder: string) =>
    active(z.string().parse(sessionId)).createCanvas(z.string().parse(folder)));
  handle(VAULT_CHANNELS.SAVE_CANVAS, (_event, sessionId: string, input: z.input<typeof canvasFileSchema>, overwrite = false) =>
    active(z.string().parse(sessionId)).saveCanvas(canvasFileSchema.parse(input), z.boolean().parse(overwrite)));
  handle(VAULT_CHANNELS.CREATE_NODE_DOCUMENT, (_event, sessionId: string) =>
    active(z.string().parse(sessionId)).createNodeDocument());
  handle(VAULT_CHANNELS.CREATE_FOLDER, (_event, sessionId: string, folder: string, name: string) =>
    active(z.string().parse(sessionId)).createFolder(z.string().parse(folder), z.string().parse(name)));
  handle(VAULT_CHANNELS.RENAME_ENTRY, (_event, sessionId: string, relative: string, name: string, documentTitle?: string) =>
    active(z.string().parse(sessionId)).renameEntry(z.string().parse(relative), z.string().parse(name), z.string().optional().parse(documentTitle)));
  handle(VAULT_CHANNELS.MOVE_ENTRY, (_event, sessionId: string, relative: string, folder: string) =>
    active(z.string().parse(sessionId)).moveEntry(z.string().parse(relative), z.string().parse(folder)));
  handle(VAULT_CHANNELS.REFRESH, (_event, sessionId: string) => active(z.string().parse(sessionId)).refresh(), snapshotResult);
  handle(VAULT_CHANNELS.DELETE_ENTRY, (_event, sessionId: string, relative: string) =>
    active(z.string().parse(sessionId)).deleteEntry(z.string().parse(relative)), snapshotResult);
  handle(VAULT_CHANNELS.RETRY_RECOVERY, (_event, sessionId: string) => active(z.string().parse(sessionId)).retryRecovery(), snapshotResult);
}
