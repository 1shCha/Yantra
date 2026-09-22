import { tiptapDocSchema } from '../shared/tiptap-document';
import type { CanvasDeletionResult } from '../shared/vault-api';
import { scanVault } from './vault-scan';
import { VaultFileAccess } from './vault-file-access';
import { FILE_EXTENSIONS, parentFolderOf, vaultFileExtension } from '../shared/vault-paths';
import { vaultTrace, vaultTraceOperation } from './vault-diagnostics';
import fs from 'node:fs/promises';
import { titleFilename, withDocumentTitle } from '../shared/document-title';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicCreate, atomicWrite } from './atomic-write';
import { canvasFileSchema, decodeCanvas, newCanvas, removeCanvasNodes, type CanvasFile } from '../shared/vault-canvas';
import { VaultDeletion, folderDeletionFingerprint, type DeletionRecord } from './vault-deletion';
import { OperationError, operationFailure } from '../shared/operation-result';
import { batchMoveTargets, movedEntryPath, normalizeBatchMoveSources, rejectNestedBatchDestination, type VaultBatchMoveResult } from '../shared/vault-batch-move';
import { orderEntries, reorderedPaths, type EntryPlacement, relocatedPath, vaultNameSchema, type VaultEntryChange } from '../shared/vault-organization';
import { decodeDocument, decodeVaultMetadata, documentFileSchema, newDocument, VAULT_FORMAT_VERSION,
  type DocumentFile, type VaultEntry, type VaultMetadata, type VaultSnapshot } from '../shared/vault-format';
import {
  assertPresentationOnlySave, CANVAS_NODE_DEFAULT_WIDTH, canvasNodePlacement, isContainerKind, packageLayoutPath,
  UNSUPPORTED_PACKAGE_OPERATION,
} from '../shared/vault-packages';

function isCode(error: Error, code: string): boolean {
  return 'code' in error && error.code === code;
}

export class VaultRepository {
  readonly sessionId = randomUUID();
  /** Test seam: fail the layout write after a package document exists. */
  static failNextPackageLayoutWrite = false;
  private documentPaths = new Map<string, string>();
  private canvasPaths = new Map<string, string>();
  private canvases = new Map<string, CanvasFile>();
  private invalidPackagePaths = new Set<string>();
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
      const metadata: VaultMetadata = { formatVersion: VAULT_FORMAT_VERSION, id: randomUUID(), createdAt: new Date().toISOString() };
      await atomicCreate(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    }
    if ((await fs.lstat(metadataPath)).isSymbolicLink()) throw new OperationError({ code: 'invalid-input', message: 'Vault metadata cannot be a symbolic link.' });
    const metadata = decodeVaultMetadata(await fs.readFile(metadataPath, 'utf8'));
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
    const scanned = await scanVault((relative) => this.resolve(relative));
    const { documentPaths, baselines, entries, appearances } = scanned;
    let { canvasPaths, canvases, invalidPackagePaths } = scanned;
    if (!acceptDiskVersions) {
      for (const [relative, raw] of this.baselines) baselines.set(relative, raw);
    }
    if (this.deletion.issue) {
      canvasPaths = new Map(canvasPaths);
      canvases = new Map(canvases);
      invalidPackagePaths = new Set(invalidPackagePaths);
      for (const [id, packagePath] of this.canvasPaths) {
        invalidPackagePaths.delete(packagePath);
        const canvas = this.canvases.get(packagePath);
        if (canvas) {
          canvasPaths.set(id, packagePath);
          canvases.set(packagePath, canvas);
        }
      }
    }
    this.documentPaths = documentPaths;
    this.canvasPaths = canvasPaths;
    this.canvases = canvases;
    this.invalidPackagePaths = invalidPackagePaths;
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

  createDocument(destination: string, position?: { x: number; y: number }): Promise<{
    path: string; document: DocumentFile; canvas?: CanvasFile; nodeId?: string;
  }> {
    return this.mutate(() => this.createDocumentAt(destination, position));
  }

  private packagePathSet(): Set<string> {
    return new Set([...this.canvasPaths.values(), ...this.invalidPackagePaths]);
  }

  private owningPackage(relative: string): string | undefined {
    const packages = this.packagePathSet();
    if (packages.has(relative)) return relative;
    const parent = parentFolderOf(relative);
    if (parent && packages.has(parent)) return parent;
  }

  private isValidPackage(relative: string): boolean {
    return [...this.canvasPaths.values()].includes(relative);
  }

  private assertPackageWritable(packagePath: string): void {
    if (this.invalidPackagePaths.has(packagePath) || !this.isValidPackage(packagePath)) {
      throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: packagePath });
    }
  }

  private assertOrdinaryDestination(folder: string, action: string): void {
    if (!folder) return;
    if (this.owningPackage(folder)) {
      throw new OperationError({ code: 'invalid-input', message: `${action} must use an ordinary folder.` });
    }
  }

  private assertBatchMoveDestination(folder: string, sources: readonly string[]): void {
    if (!folder) return;
    if (this.isValidPackage(folder)) {
      if (sources.every((relative) => relative.endsWith(FILE_EXTENSIONS.document))) return;
      throw new OperationError({ code: 'invalid-input', message: 'Move must use an ordinary folder.' });
    }
    this.assertOrdinaryDestination(folder, 'Move');
  }

  private documentPackageParent(documentPath: string): string | undefined {
    if (!documentPath.endsWith(FILE_EXTENSIONS.document)) return undefined;
    const parent = parentFolderOf(documentPath);
    return parent && this.isValidPackage(parent) ? parent : undefined;
  }

  private allowsDocumentMembershipMove(relative: string, destinationFolder: string): boolean {
    if (!relative.endsWith(FILE_EXTENSIONS.document)) return false;
    const sourcePkg = this.documentPackageParent(relative);
    const destPkg = destinationFolder && this.isValidPackage(destinationFolder) ? destinationFolder : undefined;
    if (destPkg) {
      if (sourcePkg === destPkg) return false;
      this.assertPackageWritable(destPkg);
      return true;
    }
    if (!sourcePkg) return false;
    if (destinationFolder && this.isValidPackage(destinationFolder)) return false;
    if (destinationFolder) {
      const owner = this.owningPackage(destinationFolder);
      if (owner && owner !== destinationFolder) return false;
    }
    this.assertPackageWritable(sourcePkg);
    return true;
  }

  private rejectUnsupportedPackageMutation(relative: string, destination?: string): void {
    if (relative.endsWith(FILE_EXTENSIONS.canvas)) {
      throw new OperationError({ code: 'invalid-input', message: 'The hidden layout file cannot be organized independently.' });
    }
    const sourcePackage = this.owningPackage(relative);
    if (sourcePackage) this.assertPackageWritable(sourcePackage);
    if (destination !== undefined) {
      if (this.allowsDocumentMembershipMove(relative, destination)) return;
      const destinationPackage = this.owningPackage(destination);
      if (destinationPackage && this.isValidPackage(destination)) {
        throw new OperationError({ code: 'invalid-input', message: UNSUPPORTED_PACKAGE_OPERATION });
      }
      if (destinationPackage && !this.isValidPackage(destination)) {
        throw new OperationError({ code: 'invalid-input', message: UNSUPPORTED_PACKAGE_OPERATION });
      }
      if (sourcePackage && sourcePackage !== relative && sourcePackage !== destination) {
        throw new OperationError({ code: 'invalid-input', message: UNSUPPORTED_PACKAGE_OPERATION });
      }
    }
  }

  private async createDocumentAt(destination: string, position?: { x: number; y: number }): Promise<{
    path: string; document: DocumentFile; canvas?: CanvasFile; nodeId?: string;
  }> {
    this.assertWritable();
    if (this.invalidPackagePaths.has(destination)) {
      throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: destination });
    }
    if (this.isValidPackage(destination)) return this.createPackageDocument(destination, position);
    if (this.owningPackage(destination)) {
      throw new OperationError({ code: 'invalid-input', message: UNSUPPORTED_PACKAGE_OPERATION });
    }
    return this.createDocumentFile(destination);
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

  private async createPackageDocument(packagePath: string, position?: { x: number; y: number }): Promise<{
    path: string; document: DocumentFile; canvas: CanvasFile; nodeId: string;
  }> {
    this.assertPackageWritable(packagePath);
    const created = await this.createDocumentFile(packagePath);
    const canvasId = [...this.canvasPaths].find(([, path]) => path === packagePath)?.[0];
    const current = canvasId ? this.canvases.get(packagePath) : undefined;
    if (!canvasId || !current) {
      this.invalidPackagePaths.add(packagePath);
      throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: packagePath });
    }
    const placement = canvasNodePlacement(position);
    const node = { id: randomUUID(), kind: 'document' as const, documentId: created.document.id, ...placement };
    const canvas = canvasFileSchema.parse({
      ...current,
      nodes: [...current.nodes, node],
      layerOrder: [...current.layerOrder, node.id],
      updatedAt: new Date().toISOString(),
    });
    const layoutPath = packageLayoutPath(packagePath);
    try {
      if (VaultRepository.failNextPackageLayoutWrite) {
        VaultRepository.failNextPackageLayoutWrite = false;
        throw new OperationError({ code: 'io', message: 'Layout write failed.' });
      }
      await this.unchanged(layoutPath);
      const raw = `${JSON.stringify(canvas, null, 2)}\n`;
      await atomicWrite(await this.resolve(layoutPath), raw);
      this.baselines.set(layoutPath, raw);
      this.canvases.set(packagePath, canvas);
      return { ...created, canvas, nodeId: node.id };
    } catch (error) {
      this.invalidPackagePaths.add(packagePath);
      throw error;
    }
  }

  saveDocument(input: DocumentFile, overwrite = false): Promise<{ savedAt: string }> {
    const document = documentFileSchema.parse(input);
    vaultTrace.record('document.write.request', { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(document.id) });
    return this.mutate(async () => {
    this.assertWritable();
    const relative = this.documentPaths.get(document.id);
    if (!relative) throw new OperationError({ code: 'missing', message: 'Document is not registered in this vault.' });
    const owner = this.owningPackage(relative);
    if (owner && this.invalidPackagePaths.has(owner)) {
      throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: owner });
    }
    if (!overwrite) await this.unchanged(relative);
    const current = await this.readDocument(relative);
    if (document.title !== current.title || document.createdAt !== current.createdAt) throw new OperationError({ code: 'invalid-input', message: 'Document identity cannot change during content saving.' });
    if (!overwrite) await this.unchanged(relative);
    await atomicWrite(await this.resolve(relative), `${JSON.stringify(document, null, 2)}\n`);
    this.baselines.set(relative, `${JSON.stringify(document, null, 2)}\n`);
    return { savedAt: new Date().toISOString() };
    });
  }

  async readCanvas(relative: string, mode: 'inspect' | 'accept-disk' = 'inspect'): Promise<CanvasFile> {
    const layoutPath = packageLayoutPath(relative);
    const raw = await this.files.read(layoutPath);
    const canvas = decodeCanvas(raw);
    vaultTrace.record(`canvas.read.${mode}`, { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(canvas.id) });
    if (this.invalidPackagePaths.has(relative) || this.canvasPaths.get(canvas.id) !== relative) {
      throw new OperationError({ code: 'unavailable', message: 'Canvas is missing or has an ambiguous identity or appearance.' });
    }
    if (canvas.title !== path.basename(relative)) throw new OperationError({ code: 'invalid-input', message: 'Canvas title does not match its package folder.' });
    if (mode === 'accept-disk') {
      this.baselines.set(layoutPath, raw);
      this.canvases.set(relative, canvas);
    }
    return canvas;
  }

  createCanvas(folder: string): Promise<{ path: string; canvas: CanvasFile }> {
    return this.mutate(() => this.createCanvasFile(folder));
  }

  private async createCanvasFile(folder: string): Promise<{ path: string; canvas: CanvasFile }> {
    this.assertWritable();
    this.assertOrdinaryDestination(folder, 'New Canvas');
    const absoluteFolder = await this.resolve(folder);
    if (!(await fs.stat(absoluteFolder)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Canvas destination is not a folder.' });
    for (let suffix = 0; ; suffix += 1) {
      const title = suffix === 0 ? 'Untitled' : `Untitled_${suffix + 1}`;
      const canvas = newCanvas(title);
      const packagePath = folder ? `${folder}/${title}` : title;
      const layoutPath = packageLayoutPath(packagePath);
      try {
        const absolutePackage = path.join(absoluteFolder, title);
        await fs.mkdir(absolutePackage);
        await atomicCreate(path.join(absolutePackage, `${title}${FILE_EXTENSIONS.canvas}`), `${JSON.stringify(canvas, null, 2)}\n`);
        this.canvasPaths.set(canvas.id, packagePath);
        this.baselines.set(layoutPath, `${JSON.stringify(canvas, null, 2)}\n`);
        this.canvases.set(packagePath, canvas);
        return { path: packagePath, canvas };
      } catch (error) {
        if (!(error instanceof Error && isCode(error, 'EEXIST'))) throw error;
      }
    }
  }

  saveCanvas(input: CanvasFile, overwrite = false): Promise<{ savedAt: string }> {
    const canvas = canvasFileSchema.parse(input);
    vaultTrace.record('canvas.write.request', { operation: vaultTraceOperation.getStore(), resource: vaultTrace.resource(canvas.id) });
    return this.mutate(async () => {
      this.assertWritable();
      const packagePath = this.canvasPaths.get(canvas.id);
      if (!packagePath) throw new OperationError({ code: 'missing', message: 'Canvas is not registered in this vault.' });
      this.assertPackageWritable(packagePath);
      const layoutPath = packageLayoutPath(packagePath);
      if (!overwrite) await this.unchanged(layoutPath);
      const current = await this.readCanvas(packagePath);
      const documents = new Set([...this.documentPaths].filter(([, relative]) => parentFolderOf(relative) === packagePath).map(([id]) => id));
      assertPresentationOnlySave(current, canvas, documents);
      if (!overwrite) await this.unchanged(layoutPath);
      await atomicWrite(await this.resolve(layoutPath), `${JSON.stringify(canvas, null, 2)}\n`);
      this.baselines.set(layoutPath, `${JSON.stringify(canvas, null, 2)}\n`);
      this.canvases.set(packagePath, canvas);
      return { savedAt: new Date().toISOString() };
    });
  }

  createFolder(folder: string, input: string): Promise<{ path: string }> {
    const name = vaultNameSchema.parse(input);
    return this.mutate(async () => {
      this.assertWritable();
      this.assertOrdinaryDestination(folder, 'New Folder');
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
      this.rejectUnsupportedPackageMutation(relative);
      const source = await this.entryPath(relative);
      const isFolder = (await fs.stat(source)).isDirectory();
      const extension = isFolder ? '' : this.fileExtension(relative);
      if (documentTitle !== undefined && extension !== '.yantraD') throw new OperationError({ code: 'invalid-input', message: 'Only documents have editable text titles.' });
      const parent = relative.split('/').slice(0, -1).join('/');
      const to = parent ? `${parent}/${name}${extension}` : `${name}${extension}`;
      return this.relocateEntry(relative, to, isFolder ? undefined : name, documentTitle);
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
        const packages = this.packagePathSet();
        const items: VaultEntry[] = names.filter((item) => item.name !== '.yantra' && !item.isSymbolicLink()
          && (item.isDirectory() || (item.isFile() && item.name.endsWith(FILE_EXTENSIONS.document))))
          .map((item): VaultEntry => {
            const itemPath = folder ? `${folder}/${item.name}` : item.name;
            return { name: item.name, path: itemPath,
              kind: item.isDirectory() ? packages.has(itemPath) ? 'canvas' : 'folder' : 'document' };
          })
          .sort((a, b) => Number(isContainerKind(b.kind)) - Number(isContainerKind(a.kind)) || a.name.localeCompare(b.name));
        const source = items.find((item) => item.path === relative);
        const anchor = items.find((item) => item.path === placement.anchor);
        if (!source || !anchor) throw new OperationError({ code: 'invalid-input', message: 'Choose an existing file or folder.' });
        if (isContainerKind(source.kind) !== isContainerKind(anchor.kind)) {
          throw new OperationError({ code: 'invalid-input', message: 'Folders stay above files. Reorder within the same group.' });
        }
        const saved = this.metadata.sidebarOrder ?? [];
        const order = reorderedPaths(items, saved, relative, placement);
        if (order.length === saved.length && order.every((item, index) => item === saved[index])) return { from: relative, to: relative, sidebarOrder: saved };
        await this.saveSidebarOrder(order);
        return { from: relative, to: relative, sidebarOrder: order };
      }
      this.rejectUnsupportedPackageMutation(relative, folder);
      await this.entryPath(relative);
      const parent = await this.resolve(folder);
      if (!(await fs.stat(parent)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Destination is not a folder.' });
      const name = relative.split('/').at(-1)!;
      return this.relocateEntry(relative, folder ? `${folder}/${name}` : name);
    });
  }

  moveEntries(paths: readonly string[], folder: string): Promise<VaultBatchMoveResult> {
    return this.mutate(async () => {
      const normalized = normalizeBatchMoveSources(paths, this.metadata.sidebarOrder ?? []);
      const { toMove, unchanged, targets } = batchMoveTargets(normalized, folder);
      if (!toMove.length) return { changes: [], unchanged };
      await this.preflightBatchMove(toMove, folder, targets);
      const changes: VaultEntryChange[] = [];
      try {
        for (const relative of toMove) {
          changes.push(await this.relocateEntry(relative, movedEntryPath(relative, folder)));
        }
      } catch (error) {
        const failurePath = toMove[changes.length] ?? toMove[0]!;
        return {
          changes,
          unchanged,
          failure: {
            path: failurePath,
            error: operationFailure(error),
            unattempted: toMove.slice(changes.length + 1),
          },
        };
      }
      return { changes, unchanged };
    });
  }

  private async preflightBatchMove(sources: readonly string[], folder: string, targets: readonly string[]): Promise<void> {
    this.assertWritable();
    if (folder) {
      this.assertBatchMoveDestination(folder, sources);
      const parent = await this.resolve(folder);
      if (!(await fs.stat(parent)).isDirectory()) throw new OperationError({ code: 'invalid-input', message: 'Destination is not a folder.' });
    }
    for (const relative of sources) this.rejectUnsupportedPackageMutation(relative, folder);
    if (rejectNestedBatchDestination(sources, folder)) {
      throw new OperationError({ code: 'invalid-input', message: 'A folder cannot be moved inside itself.' });
    }
    if (new Set(targets).size !== targets.length) {
      throw new OperationError({ code: 'collision', message: 'Selected items would use the same name in the destination folder.' });
    }
    const moving = new Set(sources);
    for (let index = 0; index < sources.length; index += 1) {
      const relative = sources[index]!;
      const target = targets[index]!;
      await this.entryPath(relative);
      if (relative !== target) {
        try {
          await this.resolve(target);
          if (!moving.has(target)) {
            throw new OperationError({ code: 'collision', message: 'An item with this name already exists in this location.' });
          }
        } catch (error) {
          if (error instanceof OperationError) throw error;
          if (!(error instanceof Error && isCode(error, 'ENOENT'))) throw error;
        }
      }
      const source = await this.resolve(relative);
      if ((await fs.stat(source)).isDirectory()) {
        for (const baseline of this.baselines.keys()) {
          if (baseline === relative || baseline.startsWith(`${relative}/`)) await this.unchanged(baseline);
        }
      } else {
        await this.unchanged(relative);
      }
    }
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

  /** Case-only renames on case-insensitive filesystems share one inode with the destination path. */
  private async renameCaseOnly(source: string, destination: string): Promise<void> {
    if (source === destination) return;
    const directory = path.dirname(destination);
    const temp = path.join(directory, `.yantra-case-rename-${randomUUID()}`);
    await fs.rename(source, temp);
    await fs.rename(temp, destination);
  }

  private async sameInode(source: string, destination: string): Promise<boolean> {
    try {
      const [sourceStat, destinationStat] = await Promise.all([fs.lstat(source), fs.lstat(destination)]);
      return sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino;
    } catch (error) {
      if (error instanceof Error && isCode(error, 'ENOENT')) return false;
      throw error;
    }
  }

  private async writePackageCanvas(packagePath: string, canvas: CanvasFile): Promise<void> {
    const layoutPath = packageLayoutPath(packagePath);
    if (VaultRepository.failNextPackageLayoutWrite) {
      VaultRepository.failNextPackageLayoutWrite = false;
      throw new OperationError({ code: 'io', message: 'Layout write failed.' });
    }
    await this.unchanged(layoutPath);
    const raw = `${JSON.stringify(canvas, null, 2)}\n`;
    await atomicWrite(await this.resolve(layoutPath), raw);
    this.baselines.set(layoutPath, raw);
    this.canvases.set(packagePath, canvas);
  }

  private async syncDocumentMembership(
    from: string,
    to: string,
    sourcePkg: string | undefined,
    destPkg: string | undefined,
    result: VaultEntryChange,
  ): Promise<VaultEntryChange> {
    if (sourcePkg === destPkg || !from.endsWith(FILE_EXTENSIONS.document)) return result;
    const document = result.document ?? await this.readDocument(to);
    const updated: CanvasFile[] = [];
    const destBefore = destPkg ? this.canvases.get(destPkg) : undefined;
    const sourceBefore = sourcePkg ? this.canvases.get(sourcePkg) : undefined;
    let destCommitted = false;
    let sourceCommitted = false;
    const markUnavailable = (paths: string[]) => {
      for (const packagePath of paths) this.invalidPackagePaths.add(packagePath);
    };
    try {
      if (destPkg && destPkg !== sourcePkg) {
        const current = destBefore;
        if (!current) throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: destPkg });
        const placement = canvasNodePlacement();
        const node = {
          id: randomUUID(), kind: 'document' as const, documentId: document.id,
          ...placement,
          x: placement.x + current.nodes.length * (CANVAS_NODE_DEFAULT_WIDTH + 20),
        };
        const destWritten = canvasFileSchema.parse({
          ...current,
          nodes: [...current.nodes, node],
          layerOrder: [...current.layerOrder, node.id],
          updatedAt: new Date().toISOString(),
        });
        await this.writePackageCanvas(destPkg, destWritten);
        destCommitted = true;
        updated.push(destWritten);
      }
      if (sourcePkg && sourcePkg !== destPkg) {
        if (!sourceBefore) throw new OperationError({ code: 'unavailable', message: 'This canvas package is unavailable.', path: sourcePkg });
        const removed = new Set(sourceBefore.nodes.filter((node) => node.documentId === document.id).map((node) => node.id));
        if (removed.size) {
          const sourceWritten = removeCanvasNodes(sourceBefore, removed);
          await this.writePackageCanvas(sourcePkg, sourceWritten);
          sourceCommitted = true;
          updated.push(sourceWritten);
        }
      }
    } catch (error) {
      const affected = [destPkg, sourcePkg].filter((item): item is string => !!item);
      try {
        if (destCommitted && destPkg && destBefore) await this.writePackageCanvas(destPkg, destBefore);
        if (sourceCommitted && sourcePkg && sourceBefore) await this.writePackageCanvas(sourcePkg, sourceBefore);
        if (from !== to) await this.relocate(to, from);
      } catch (rollbackError) {
        markUnavailable(affected);
        const rollbackMessage = operationFailure(rollbackError).message;
        throw new OperationError({
          code: 'io',
          message: `${operationFailure(error).message} The document move could not be rolled back: ${rollbackMessage}`,
        });
      }
      throw error;
    }
    return updated.length ? { ...result, canvases: updated } : result;
  }

  private async relocateEntry(from: string, to: string, title?: string, documentTitle?: string): Promise<VaultEntryChange> {
    const sourcePkg = this.documentPackageParent(from);
    const destFolder = parentFolderOf(to);
    const destPkg = destFolder && this.isValidPackage(destFolder) ? destFolder : undefined;
    let result = await this.relocate(from, to, title, documentTitle);
    if (from !== to && from.endsWith(FILE_EXTENSIONS.document) && (sourcePkg || destPkg)) {
      result = await this.syncDocumentMembership(from, to, sourcePkg, destPkg, result);
    }
    if (!this.isValidPackage(to)) return result;
    return this.alignPackageLayout(from, to, result);
  }

  private async alignPackageLayout(from: string, to: string, result: VaultEntryChange): Promise<VaultEntryChange> {
    const layoutAfterMove = relocatedPath(packageLayoutPath(from), from, to);
    const expectedLayout = packageLayoutPath(to);
    const title = to.split('/').at(-1)!;
    const current = this.canvases.get(to);
    if (!current) {
      this.invalidPackagePaths.add(to);
      return { ...result, warning: result.warning ?? 'The canvas package was moved, but it is now unavailable.' };
    }
    if (layoutAfterMove === expectedLayout && current.title === title) return result;
    const updated = canvasFileSchema.parse({ ...current, title, updatedAt: new Date().toISOString() });
    try {
      if (VaultRepository.failNextPackageLayoutWrite) {
        VaultRepository.failNextPackageLayoutWrite = false;
        throw new OperationError({ code: 'io', message: 'Layout write failed.' });
      }
      await this.unchanged(layoutAfterMove);
      const raw = `${JSON.stringify(updated, null, 2)}\n`;
      const source = await this.resolve(layoutAfterMove);
      const destination = path.join(await this.resolve(to), `${title}${FILE_EXTENSIONS.canvas}`);
      if (await this.sameInode(source, destination)) {
        await atomicWrite(source, raw);
        await this.renameCaseOnly(source, destination);
      } else {
        await atomicCreate(destination, raw);
        try { await fs.unlink(source); }
        catch (error) {
          await fs.unlink(destination).catch(() => { /* Preserve both copies if rollback cannot remove the destination. */ });
          throw error;
        }
      }
      this.baselines.delete(layoutAfterMove);
      this.baselines.set(expectedLayout, raw);
      this.canvases.set(to, updated);
      return { ...result, canvas: updated };
    } catch (error) {
      this.invalidPackagePaths.add(to);
      const message = operationFailure(error).message;
      return { ...result, warning: result.warning
        ? `${result.warning} The package layout could not be renamed: ${message}`
        : `The package was moved, but its layout could not be renamed: ${message}` };
    }
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
    const caseOnlyRename = await this.sameInode(source, destination);
    if (caseOnlyRename) {
      if ((await fs.stat(source)).isDirectory()) {
        await Promise.all([...this.baselines.keys()].filter((relative) => relative.startsWith(`${from}/`)).map((relative) => this.unchanged(relative)));
        await this.renameCaseOnly(source, destination);
      } else {
        const extension = this.fileExtension(from);
        await this.unchanged(from);
        const file = extension === FILE_EXTENSIONS.document ? await this.readDocument(from) : await this.readCanvas(from);
        if (title) {
          const renamed = extension === FILE_EXTENSIONS.document && documentTitle !== undefined
            ? { ...file, title, doc: tiptapDocSchema.parse(withDocumentTitle(documentFileSchema.parse(file).doc, documentTitle)), updatedAt: new Date().toISOString() }
            : { ...file, title, updatedAt: new Date().toISOString() };
          const raw = `${JSON.stringify(renamed, null, 2)}\n`;
          await atomicWrite(source, raw);
          this.baselines.set(from, raw);
          if (extension === FILE_EXTENSIONS.document) result.document = documentFileSchema.parse(renamed);
          else result.canvas = canvasFileSchema.parse(renamed);
        }
        await this.renameCaseOnly(source, destination);
      }
    } else if ((await fs.stat(source)).isDirectory()) {
      await Promise.all([...this.baselines.keys()].filter((relative) => relative.startsWith(`${from}/`)).map((relative) => this.unchanged(relative)));
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
    this.invalidPackagePaths = new Set([...this.invalidPackagePaths].map((relative) => relocatedPath(relative, from, to)));
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
      if (!canvas || !canvasPath || this.invalidPackagePaths.has(canvasPath)) throw new OperationError({ code: 'unavailable', message: 'Canvas is unavailable.' });
      const ids = new Set(nodeIds);
      const nodes = canvas.nodes.filter((node) => ids.has(node.id));
      const flatten = (entries: VaultEntry[]): VaultEntry[] => entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
      const entries = flatten(before.entries);
      if (entries.some((entry) => entry.kind === 'canvas' && entry.error && entry.path !== canvasPath)) {
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
          record.canvases.push(...(await Promise.all([...this.canvases].map(async ([packagePath, file]) => {
            const removed = new Set(file.nodes.filter((node) => node.documentId === documentId).map((node) => node.id));
            if (!removed.size) return null;
            const layoutPath = packageLayoutPath(packagePath);
            return { path: layoutPath, before: await this.unchanged(layoutPath),
              after: `${JSON.stringify(removeCanvasNodes(file, removed), null, 2)}\n` };
          }))).filter((change): change is NonNullable<typeof change> => change !== null));
          await this.deletion.begin(record);
          for (const change of record.canvases) {
            const raw = await this.files.read(change.path);
            // Recovery may have stopped before writing every affected canvas.
            if (raw === change.after) {
              this.baselines.set(change.path, raw);
              this.canvases.set(parentFolderOf(change.path), decodeCanvas(raw));
              changedPaths.add(parentFolderOf(change.path));
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
      if (!entry || (entry.error && entry.kind !== 'canvas')) throw new OperationError({ code: 'invalid-input', message: 'Only valid vault files or folders can be deleted.' });
      const contains = (candidate: string) => candidate === relative || (isContainerKind(entry.kind) && candidate.startsWith(`${relative}/`));
      const affected = entries.filter((candidate) => contains(candidate.path));
      if (entry.kind !== 'canvas' && affected.some((candidate) => candidate.error)) throw new OperationError({ code: 'unavailable', message: 'Resolve unavailable files in this folder before deleting it.' });
      const record: DeletionRecord = { version: 1, path: relative, kind: entry.kind === 'document' ? 'document' : 'folder', original: '', canvases: [] };
      if (entry.kind === 'folder' || entry.kind === 'canvas') {
        record.original = await folderDeletionFingerprint(source);
        if (!entry.error) {
          await Promise.all(affected.flatMap((candidate) => {
            if (candidate.kind === 'document' && !candidate.error) return [this.unchanged(candidate.path)];
            if (candidate.kind === 'canvas' && !candidate.error) return [this.unchanged(packageLayoutPath(candidate.path))];
            return [];
          }));
        }
      } else record.original = await this.unchanged(relative);
      const documentIds = new Set(affected.flatMap((candidate) => candidate.documentId ? [candidate.documentId] : []));
      if (documentIds.size) {
        if (entries.some((candidate) => !contains(candidate.path) && candidate.kind === 'canvas' && candidate.error)) throw new OperationError({ code: 'unavailable', message: 'Resolve unavailable canvases before deleting a document; its appearances cannot be checked safely.' });
        record.canvases.push(...(await Promise.all([...this.canvases].filter(([packagePath]) => !contains(packagePath)).map(async ([packagePath, canvas]) => {
          const ids = new Set(canvas.nodes.filter((node) => documentIds.has(node.documentId)).map((node) => node.id));
          if (!ids.size) return null;
          const layoutPath = packageLayoutPath(packagePath);
          return { path: layoutPath, before: await this.unchanged(layoutPath), after: `${JSON.stringify(removeCanvasNodes(canvas, ids), null, 2)}\n` };
        }))).filter((change): change is NonNullable<typeof change> => change !== null));
      }
      await this.deletion.begin(record);
      return this.scanFiles(true);
    });
  }
}
