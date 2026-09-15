import { tiptapDocSchema } from '../shared/tiptap-document';
import type { CanvasDeletionResult } from '../shared/vault-api';
import { scanVault } from './vault-scan';
import { VaultFileAccess } from './vault-file-access';
import { FILE_EXTENSIONS, vaultFileExtension } from '../shared/vault-paths';
import { vaultTrace, vaultTraceOperation } from './vault-diagnostics';
import fs from 'node:fs/promises';
import { titleFilename, withDocumentTitle } from '../shared/document-title';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicCreate, atomicWrite } from './atomic-write';
import { migrateVaultNames } from './vault-name-migration';
import { canvasFileSchema, decodeCanvas, newCanvas, removeCanvasNodes, type CanvasFile } from '../shared/vault-canvas';
import { VaultDeletion, folderDeletionFingerprint, type DeletionRecord } from './vault-deletion';
import { OperationError, operationFailure } from '../shared/operation-result';
import { orderEntries, reorderedPaths, type EntryPlacement, relocatedPath, vaultNameSchema, type VaultEntryChange } from '../shared/vault-organization';
import { decodeDocument, documentFileSchema, newDocument, vaultMetadataSchema,
  type DocumentFile, type VaultEntry, type VaultMetadata, type VaultSnapshot } from '../shared/vault-format';

function isCode(error: Error, code: string): boolean {
  return 'code' in error && error.code === code;
}

export class VaultRepository {
  readonly sessionId = randomUUID();
  private documentPaths = new Map<string, string>();
  private canvasPaths = new Map<string, string>();
  private canvases = new Map<string, CanvasFile>();
  private mutation: Promise<void> = Promise.resolve();
  private baselines = new Map<string, string>();
  private readonly deletion: VaultDeletion;
  private readonly files: VaultFileAccess;

  private assertWritable(): void {
    if (this.deletion.issue) throw new OperationError({ code: 'recovery-required', message: 'Complete the pending deletion recovery before editing the vault.', path: this.deletion.issue.path });
  }

  private async unchanged(relative: string): Promise<string> {
    let current: string;
    try { current = await this.files.read(relative); }
    catch (error) {
      const issue = operationFailure(error);
      throw new OperationError({ ...issue, code: issue.code === 'missing' ? 'conflict' : issue.code,
        path: relative, message: `File is missing or unavailable: ${relative}. ${issue.message}` });
    }
    if (this.baselines.get(relative) !== current) throw new OperationError({ code: 'conflict', path: relative, message: `File changed externally: ${relative}. Reload from disk or explicitly overwrite to continue.` });
    return current;
  }

  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const operation = vaultTraceOperation.getStore();
    vaultTrace.record('filesystem.queued', { operation });
    const result = this.mutation.then(async () => {
      vaultTrace.record('filesystem.start', { operation });
      try {
        const value = await work();
        vaultTrace.record('filesystem.finish', { operation, outcome: 'success' });
        return value;
      } catch (error) {
        vaultTrace.record('filesystem.finish', { operation, outcome: 'failure', code: operationFailure(error).code });
        throw error;
      }
    });
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private constructor(readonly root: string, public metadata: VaultMetadata, trash: (absolute: string) => Promise<void>) {
    this.files = new VaultFileAccess(root);
    this.deletion = new VaultDeletion(root, (relative) => this.resolve(relative), trash);
  }

  static async open(root: string, create = false, trash: (absolute: string) => Promise<void> = async () => { throw new OperationError({ code: 'unavailable', message: 'System Trash is unavailable.' }); }): Promise<VaultRepository> {
    const canonicalRoot = await fs.realpath(root);
    if (!(await fs.stat(canonicalRoot)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Choose a vault folder.' });
    const metadataFolder = path.join(canonicalRoot, '.yantra');
    try {
      if ((await fs.lstat(metadataFolder)).isSymbolicLink()) throw new OperationError({ code: 'invalid-input', message: 'Vault metadata cannot be a symbolic link.' });
    } catch (error) {
      if (!(error instanceof Error && isCode(error, 'ENOENT'))) throw error;
    }
    const metadataPath = path.join(metadataFolder, 'vault.json');
    if (create) {
      const metadata: VaultMetadata = { formatVersion: 1, id: randomUUID(), createdAt: new Date().toISOString() };
      await atomicCreate(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    }
    if ((await fs.lstat(metadataPath)).isSymbolicLink()) throw new OperationError({ code: 'invalid-input', message: 'Vault metadata cannot be a symbolic link.' });
    const metadata = vaultMetadataSchema.parse(JSON.parse(await fs.readFile(metadataPath, 'utf8')));
    await migrateVaultNames(canonicalRoot);
    const repository = new VaultRepository(canonicalRoot, metadata, trash);
    await repository.deletion.resume();
    return repository;
  }

  private resolve(relative: string): Promise<string> { return this.files.resolve(relative); }

  scan(): Promise<VaultSnapshot> { return this.mutate(() => this.scanFiles()); }

  refresh(): Promise<VaultSnapshot> {
    return this.mutate(() => this.scanFiles(true));
  }

  retryRecovery(): Promise<VaultSnapshot> {
    return this.mutate(async () => {
      await this.deletion.resume();
      return this.scanFiles(true);
    });
  }

  private async scanFiles(acceptDiskVersions = false): Promise<VaultSnapshot> {
    vaultTrace.record(acceptDiskVersions ? 'scan.accept-disk' : 'scan.inspect', { operation: vaultTraceOperation.getStore() });
    const { documentPaths, canvasPaths, canvases, baselines, entries, appearances } = await scanVault((relative) => this.resolve(relative));
    if (!acceptDiskVersions) {
      for (const [relative, raw] of this.baselines) baselines.set(relative, raw);
    }
    this.documentPaths = documentPaths;
    this.canvasPaths = canvasPaths;
    this.canvases = canvases;
    this.baselines = baselines;
    return { sessionId: this.sessionId, root: this.root, name: path.basename(this.root), metadata: this.metadata, entries: orderEntries(entries, this.metadata.sidebarOrder), appearances, recovery: this.deletion.issue };
  }

  async readDocument(relative: string, mode: 'inspect' | 'accept-disk' = 'inspect'): Promise<DocumentFile> {
    const raw = await this.files.read(relative);
    const document = decodeDocument(raw);
    vaultTrace.record(`document.read.${mode}`, { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(document.id) });
    if (this.documentPaths.get(document.id) !== relative) throw new OperationError({ code: 'unavailable', message: 'Document is missing or has an ambiguous ID.' });
    if (document.title !== path.basename(relative, FILE_EXTENSIONS.document)) throw new OperationError({ code: 'invalid-input', message: 'Document title does not match its filename.' });
    if (mode === 'accept-disk') this.baselines.set(relative, raw);
    return document;
  }

  createDocument(folder: string): Promise<{ path: string; document: DocumentFile }> {
    return this.mutate(() => this.createDocumentFile(folder));
  }

  private async createDocumentFile(folder: string): Promise<{ path: string; document: DocumentFile }> {
    this.assertWritable();
    const absoluteFolder = await this.resolve(folder);
    if (!(await fs.stat(absoluteFolder)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Document destination is not a folder.' });
    for (let suffix = 0; ; suffix += 1) {
      const title = suffix === 0 ? 'Untitled' : `Untitled_${suffix + 1}`;
      const document = newDocument(title);
      const relative = folder ? `${folder}/${title}${FILE_EXTENSIONS.document}` : `${title}${FILE_EXTENSIONS.document}`;
      try {
        await atomicCreate(path.join(absoluteFolder, `${title}${FILE_EXTENSIONS.document}`), `${JSON.stringify(document, null, 2)}\n`);
        this.documentPaths.set(document.id, relative);
        this.baselines.set(relative, `${JSON.stringify(document, null, 2)}\n`);
        return { path: relative, document };
      } catch (error) {
        if (!(error instanceof Error && isCode(error, 'EEXIST'))) throw error;
      }
    }
  }

  saveDocument(input: DocumentFile, overwrite = false): Promise<{ savedAt: string }> {
    const document = documentFileSchema.parse(input);
    vaultTrace.record('document.write.request', { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(document.id) });
    return this.mutate(async () => {
    this.assertWritable();
    const relative = this.documentPaths.get(document.id);
    if (!relative) throw new OperationError({ code: 'missing', message: 'Document is not registered in this vault.' });
    if (!overwrite) await this.unchanged(relative);
    const current = await this.readDocument(relative);
    if (document.title !== current.title || document.createdAt !== current.createdAt) throw new OperationError({ code: 'invalid-input', message: 'Document identity cannot change during content saving.' });
    if (!overwrite) await this.unchanged(relative);
    await atomicWrite(await this.resolve(relative), `${JSON.stringify(document, null, 2)}\n`);
    this.baselines.set(relative, `${JSON.stringify(document, null, 2)}\n`);
    return { savedAt: new Date().toISOString() };
    });
  }

  createNodeDocument(): Promise<{ path: string; document: DocumentFile }> {
    return this.mutate(async () => {
    this.assertWritable();
    try {
      await fs.mkdir(path.join(this.root, 'Unfiled'));
    } catch (error) {
      if (!(error instanceof Error && isCode(error, 'EEXIST'))) throw error;
    }
    return this.createDocumentFile('Unfiled');
    });
  }

  async readCanvas(relative: string, mode: 'inspect' | 'accept-disk' = 'inspect'): Promise<CanvasFile> {
    const raw = await this.files.read(relative);
    const canvas = decodeCanvas(raw);
    vaultTrace.record(`canvas.read.${mode}`, { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(canvas.id) });
    if (this.canvasPaths.get(canvas.id) !== relative) throw new OperationError({ code: 'unavailable', message: 'Canvas is missing or has an ambiguous identity or appearance.' });
    if (canvas.title !== path.basename(relative, FILE_EXTENSIONS.canvas)) throw new OperationError({ code: 'invalid-input', message: 'Canvas title does not match its filename.' });
    if (mode === 'accept-disk') {
      this.baselines.set(relative, raw);
      this.canvases.set(relative, canvas);
    }
    return canvas;
  }

  createCanvas(folder: string): Promise<{ path: string; canvas: CanvasFile }> {
    return this.mutate(() => this.createCanvasFile(folder));
  }

  private async createCanvasFile(folder: string): Promise<{ path: string; canvas: CanvasFile }> {
    this.assertWritable();
    const absoluteFolder = await this.resolve(folder);
    if (!(await fs.stat(absoluteFolder)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Canvas destination is not a folder.' });
    for (let suffix = 0; ; suffix += 1) {
      const title = suffix === 0 ? 'Untitled' : `Untitled_${suffix + 1}`;
      const canvas = newCanvas(title);
      const relative = folder ? `${folder}/${title}${FILE_EXTENSIONS.canvas}` : `${title}${FILE_EXTENSIONS.canvas}`;
      try {
        await atomicCreate(path.join(absoluteFolder, `${title}${FILE_EXTENSIONS.canvas}`), `${JSON.stringify(canvas, null, 2)}\n`);
        this.canvasPaths.set(canvas.id, relative);
        this.baselines.set(relative, `${JSON.stringify(canvas, null, 2)}\n`);
        this.canvases.set(relative, canvas);
        return { path: relative, canvas };
      } catch (error) {
        if (!(error instanceof Error && isCode(error, 'EEXIST'))) throw error;
      }
    }
  }

  saveCanvas(input: CanvasFile, overwrite = false): Promise<{ savedAt: string }> {
    const canvas = canvasFileSchema.parse(input);
    vaultTrace.record('canvas.write.request', { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(canvas.id) });
    // Serialize cross-canvas claims, not just writes to an individual file.
    return this.mutate(async () => {
      this.assertWritable();
      const relative = this.canvasPaths.get(canvas.id);
      if (!relative) throw new OperationError({ code: 'missing', message: 'Canvas is not registered in this vault.' });
      if (!overwrite) await this.unchanged(relative);
      const current = await this.readCanvas(relative);
      if (canvas.title !== current.title || canvas.createdAt !== current.createdAt) throw new OperationError({ code: 'invalid-input', message: 'Canvas identity cannot change during saving.' });
      for (const node of canvas.nodes) {
        for (const other of this.canvases.values()) {
          if (other.id !== canvas.id && other.nodes.some((candidate) => candidate.documentId === node.documentId)) {
            throw new OperationError({ code: 'invalid-input', message: 'A document can appear on only one canvas.' });
          }
        }
        const existingReference = current.nodes.some((candidate) => candidate.id === node.id && candidate.documentId === node.documentId);
        if (!existingReference) {
          const documentPath = this.documentPaths.get(node.documentId);
          if (!documentPath) throw new OperationError({ code: 'invalid-input', message: 'Save the document before adding its canvas reference.' });
          await this.readDocument(documentPath);
        }
      }
      if (!overwrite) await this.unchanged(relative);
      await atomicWrite(await this.resolve(relative), `${JSON.stringify(canvas, null, 2)}\n`);
      this.baselines.set(relative, `${JSON.stringify(canvas, null, 2)}\n`);
      this.canvases.set(relative, canvas);
      return { savedAt: new Date().toISOString() };
    });
  }

  createFolder(folder: string, input: string): Promise<{ path: string }> {
    const name = vaultNameSchema.parse(input);
    return this.mutate(async () => {
      this.assertWritable();
      const parent = await this.resolve(folder);
      if (!(await fs.stat(parent)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Destination is not a folder.' });
      await fs.mkdir(path.join(parent, name));
      return { path: folder ? `${folder}/${name}` : name };
    });
  }

  renameEntry(relative: string, input: string, documentTitle?: string): Promise<VaultEntryChange> {
    const name = vaultNameSchema.parse(input);
    if (documentTitle !== undefined && titleFilename(documentTitle) !== name) throw new OperationError({ code: 'invalid-input', message: 'The filename must match the document title.' });
    return this.mutate(async () => {
      const source = await this.entryPath(relative);
      const isFolder = (await fs.stat(source)).isDirectory();
      const extension = isFolder ? '' : this.fileExtension(relative);
      if (documentTitle !== undefined && extension !== '.yantraD') throw new OperationError({ code: 'invalid-input', message: 'Only documents have editable text titles.' });
      const parent = relative.split('/').slice(0, -1).join('/');
      return this.relocate(relative, parent ? `${parent}/${name}${extension}` : `${name}${extension}`, isFolder ? undefined : name, documentTitle);
    });
  }

  moveEntry(relative: string, folder: string, placement?: EntryPlacement): Promise<VaultEntryChange> {
    return this.mutate(async () => {
      if (placement) {
        this.assertWritable();
        if (relative.split('/').slice(0, -1).join('/') !== folder || placement.anchor.split('/').slice(0, -1).join('/') !== folder) {
          throw new OperationError({ code: 'invalid-input', message: 'Reorder items within the same folder.' });
        }
        // Ordering needs sibling names and kinds, not document contents or a full scan.
        const directory = await this.resolve(folder);
        const names = await fs.readdir(directory, { withFileTypes: true });
        const items: VaultEntry[] = names.filter((item) => item.name !== '.yantra' && !item.isSymbolicLink()
          && (item.isDirectory() || (item.isFile() && /\.yantra[DC]$/.test(item.name))))
          .map((item): VaultEntry => ({ name: item.name, path: folder ? `${folder}/${item.name}` : item.name,
            kind: item.isDirectory() ? 'folder' : item.name.endsWith('.yantraD') ? 'document' : 'canvas' }))
          .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
        const source = items.find((item) => item.path === relative);
        const anchor = items.find((item) => item.path === placement.anchor);
        if (!source || !anchor) throw new OperationError({ code: 'invalid-input', message: 'Choose an existing file or folder.' });
        if ((source.kind === 'folder') !== (anchor.kind === 'folder')) {
          throw new OperationError({ code: 'invalid-input', message: 'Folders stay above files. Reorder within the same group.' });
        }
        const saved = this.metadata.sidebarOrder ?? [];
        const order = reorderedPaths(items, saved, relative, placement);
        if (order.length === saved.length && order.every((item, index) => item === saved[index])) return { from: relative, to: relative, sidebarOrder: saved };
        await this.saveSidebarOrder(order);
        return { from: relative, to: relative, sidebarOrder: order };
      }
      await this.entryPath(relative);
      const parent = await this.resolve(folder);
      if (!(await fs.stat(parent)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Destination is not a folder.' });
      const name = relative.split('/').at(-1)!;
      return this.relocate(relative, folder ? `${folder}/${name}` : name);
    });
  }

  private async saveSidebarOrder(sidebarOrder: string[]): Promise<void> {
    const metadataPath = path.join(this.root, '.yantra', 'vault.json');
    if ((await fs.lstat(path.dirname(metadataPath))).isSymbolicLink() || (await fs.lstat(metadataPath)).isSymbolicLink()) {
      throw new OperationError({ code: 'invalid-input', message: 'Vault metadata cannot be a symbolic link.' });
    }
    const metadata = { ...this.metadata, sidebarOrder };
    await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    this.metadata = metadata;
  }

  private entryPath(relative: string): Promise<string> {
    if (!relative || relative.split('/').some((part) => !part)) throw new OperationError({ code: 'invalid-input', message: 'Choose a file or folder inside the vault, not the vault root.' });
    return this.resolve(relative);
  }

  private fileExtension(relative: string): '.yantraD' | '.yantraC' {
    return vaultFileExtension(relative);
  }

  private async relocate(from: string, to: string, title?: string, documentTitle?: string): Promise<VaultEntryChange> {
    this.assertWritable();
    if (from === to) {
      if (documentTitle === undefined) return { from, to };
      await this.unchanged(from);
      const file = await this.readDocument(from);
      const doc = tiptapDocSchema.parse(withDocumentTitle(file.doc, documentTitle));
      if (doc === file.doc || JSON.stringify(doc) === JSON.stringify(file.doc)) return { from, to, document: file };
      const updated = { ...file, doc, updatedAt: new Date().toISOString() };
      await this.unchanged(from);
      const raw = `${JSON.stringify(updated, null, 2)}\n`;
      await atomicWrite(await this.resolve(from), raw);
      this.baselines.set(from, raw);
      return { from, to, document: updated };
    }
    if (to.startsWith(`${from}/`)) throw new OperationError({ code: 'invalid-input', message: 'A folder cannot be moved inside itself.' });
    const source = await this.entryPath(from);
    const targetFolder = to.split('/').slice(0, -1).join('/');
    const destination = path.join(await this.resolve(targetFolder), to.split('/').at(-1)!);
    const result: VaultEntryChange = { from, to };
    if ((await fs.stat(source)).isDirectory()) {
      for (const relative of this.baselines.keys()) if (relative.startsWith(`${from}/`)) await this.unchanged(relative);
      // Reserve an empty destination exclusively; rename replaces only our empty directory.
      await fs.mkdir(destination);
      try { await fs.rename(source, destination); }
      catch (error) {
        await fs.rmdir(destination).catch(() => { /* Never remove unexpected destination contents. */ });
        throw error;
      }
    } else {
      const extension = this.fileExtension(from);
      await this.unchanged(from);
      const file = extension === FILE_EXTENSIONS.document ? await this.readDocument(from) : await this.readCanvas(from);
      if (title) {
        const renamed = extension === FILE_EXTENSIONS.document && documentTitle !== undefined
          ? { ...file, title, doc: tiptapDocSchema.parse(withDocumentTitle(documentFileSchema.parse(file).doc, documentTitle)), updatedAt: new Date().toISOString() }
          : { ...file, title, updatedAt: new Date().toISOString() };
        await atomicCreate(destination, `${JSON.stringify(renamed, null, 2)}\n`);
        if (extension === FILE_EXTENSIONS.document) result.document = documentFileSchema.parse(renamed);
        else result.canvas = canvasFileSchema.parse(renamed);
      } else {
        await fs.link(source, destination);
      }
      try { await fs.unlink(source); }
      catch (error) {
        await fs.unlink(destination).catch(() => { /* Preserve both copies if rollback cannot remove the destination. */ });
        throw error;
      }
    }
    for (const [id, relative] of this.documentPaths) this.documentPaths.set(id, relocatedPath(relative, from, to));
    for (const [relative, raw] of Array.from(this.baselines)) {
      const next = relocatedPath(relative, from, to);
      if (next !== relative) {
        this.baselines.delete(relative);
        this.baselines.set(next, result.document || result.canvas ? `${JSON.stringify(result.document ?? result.canvas, null, 2)}\n` : raw);
      }
    }
    for (const [id, relative] of this.canvasPaths) this.canvasPaths.set(id, relocatedPath(relative, from, to));
    const canvasesBeforeMove = Array.from(this.canvases);
    for (const [relative, canvas] of canvasesBeforeMove) {
      const next = relocatedPath(relative, from, to);
      if (next !== relative) {
        this.canvases.delete(relative);
        this.canvases.set(next, result.canvas?.id === canvas.id ? result.canvas : canvas);
      }
    }
    if (this.metadata.sidebarOrder) {
      const order = this.metadata.sidebarOrder.map((item) => relocatedPath(item, from, to));
      // The filesystem move has committed. Always return its new path even if
      // saving the presentation preference fails, so the workspace stays in sync.
      try { await this.saveSidebarOrder(order); }
      catch (error) {
        this.metadata = { ...this.metadata, sidebarOrder: order };
        result.warning = `The item was moved or renamed, but its sidebar order could not be saved: ${operationFailure(error).message}`;
      }
      result.sidebarOrder = order;
    }
    return result;
  }

  deleteCanvasNodes(canvasId: string, nodeIds: string[]): Promise<CanvasDeletionResult> {
    return this.mutate(async () => {
      this.assertWritable();
      const before = await this.scanFiles();
      const canvasPath = this.canvasPaths.get(canvasId);
      const canvas = canvasPath && this.canvases.get(canvasPath);
      if (!canvas) throw new OperationError({ code: 'unavailable', message: 'Canvas is unavailable.' });
      const ids = new Set(nodeIds);
      const nodes = canvas.nodes.filter((node) => ids.has(node.id));
      const flatten = (entries: VaultEntry[]): VaultEntry[] => entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
      const entries = flatten(before.entries);
      if (entries.some((entry) => entry.kind === 'canvas' && entry.error)) {
        throw new OperationError({ code: 'unavailable', message: 'Resolve unavailable canvases before deleting documents.' });
      }
      const paths = nodes.map((node) => {
        const relative = this.documentPaths.get(node.documentId);
        if (!relative || entries.find((entry) => entry.path === relative)?.error) {
          throw new OperationError({ code: 'unavailable', message: 'A selected document is unavailable.' });
        }
        return { relative, documentId: node.documentId };
      });
      const changedPaths = new Set<string>();
      let error: CanvasDeletionResult['error'];
      for (const { relative, documentId } of paths) {
        try {
          const record: DeletionRecord = { version: 1, path: relative, kind: 'document', original: await this.unchanged(relative), canvases: [] };
          for (const [relativeCanvas, file] of this.canvases) {
            const removed = new Set(file.nodes.filter((node) => node.documentId === documentId).map((node) => node.id));
            if (!removed.size) continue;
            record.canvases.push({ path: relativeCanvas, before: await this.unchanged(relativeCanvas),
              after: `${JSON.stringify(removeCanvasNodes(file, removed), null, 2)}\n` });
          }
          await this.deletion.begin(record);
          for (const change of record.canvases) {
            const raw = await this.files.read(change.path);
            // Recovery may have stopped before writing every affected canvas.
            if (raw === change.after) {
              this.baselines.set(change.path, raw);
              this.canvases.set(change.path, decodeCanvas(raw));
              changedPaths.add(change.path);
            }
          }
          if (this.deletion.issue) {
            error = { code: 'recovery-required', ...this.deletion.issue };
            break;
          }
          this.baselines.delete(relative);
          this.documentPaths.delete(documentId);
        } catch (cause) { error = operationFailure(cause); break; }
      }
      // Preserve unrelated baselines: concurrent external edits must still conflict.
      const snapshot = await this.scanFiles();
      return { snapshot, canvases: [...changedPaths].flatMap((relative) => {
        const file = this.canvases.get(relative);
        return file ? [file] : [];
      }), error };
    });
  }

  deleteEntry(relative: string): Promise<VaultSnapshot> {
    return this.mutate(async () => {
      this.assertWritable();
      const source = await this.entryPath(relative);
      const snapshot = await this.scanFiles();
      const flatten = (entries: VaultEntry[]): VaultEntry[] => entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
      const entries = flatten(snapshot.entries);
      const entry = entries.find((candidate) => candidate.path === relative);
      if (!entry || entry.error) throw new OperationError({ code: 'invalid-input', message: 'Only valid vault files or folders can be deleted.' });
      const contains = (candidate: string) => candidate === relative || (entry.kind === 'folder' && candidate.startsWith(`${relative}/`));
      const affected = entries.filter((candidate) => contains(candidate.path));
      if (affected.some((candidate) => candidate.error)) throw new OperationError({ code: 'unavailable', message: 'Resolve unavailable files in this folder before deleting it.' });
      const record: DeletionRecord = { version: 1, path: relative, kind: entry.kind, original: '', canvases: [] };
      if (entry.kind === 'folder') {
        record.original = await folderDeletionFingerprint(source);
        for (const candidate of affected) {
          if (candidate.kind !== 'folder') await this.unchanged(candidate.path);
        }
      } else record.original = await this.unchanged(relative);
      const documentIds = new Set(affected.flatMap((candidate) => candidate.documentId ? [candidate.documentId] : []));
      if (documentIds.size) {
        if (entries.some((candidate) => !contains(candidate.path) && candidate.kind === 'canvas' && candidate.error)) throw new OperationError({ code: 'unavailable', message: 'Resolve unavailable canvases before deleting a document; its appearances cannot be checked safely.' });
        for (const [canvasPath, canvas] of this.canvases) {
          if (contains(canvasPath)) continue;
          const ids = new Set(canvas.nodes.filter((node) => documentIds.has(node.documentId)).map((node) => node.id));
          if (ids.size) record.canvases.push({ path: canvasPath, before: await this.unchanged(canvasPath), after: `${JSON.stringify(removeCanvasNodes(canvas, ids), null, 2)}\n` });
        }
      }
      await this.deletion.begin(record);
      return this.scanFiles(true);
    });
  }
}
