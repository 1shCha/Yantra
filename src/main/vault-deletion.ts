import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { atomicCreate, atomicWrite } from './atomic-write';
import { vaultTrace, vaultTraceOperation } from './vault-diagnostics';
import { FILE_EXTENSIONS } from '../shared/vault-paths';

const relativePath = z.string().min(1).refine((value) => !path.isAbsolute(value) && !value.includes('\\')
  && value.split('/').every((part) => part && part !== '.' && part !== '..' && part !== '.yantra'));
export const deletionSchema = z.object({
  version: z.literal(1), path: relativePath, kind: z.enum(['document', 'canvas', 'folder']),
  original: z.string(),
  canvases: z.array(z.object({ path: relativePath, before: z.string(), after: z.string() }).strict()),
}).strict();
export type DeletionRecord = z.infer<typeof deletionSchema>;

/** Fingerprint the whole folder without following symbolic links outside it. */
export async function folderDeletionFingerprint(root: string): Promise<string> {
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('Deletion source is no longer a folder.');
  const digest = createHash('sha256');
  async function visit(folder: string, prefix: string) {
    for (const name of (await fs.readdir(folder)).sort()) {
      const absolute = path.join(folder, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        digest.update(JSON.stringify(['link', relative, await fs.readlink(absolute)]));
      } else if (stat.isDirectory()) {
        digest.update(JSON.stringify(['folder', relative]));
        await visit(absolute, relative);
      } else if (stat.isFile()) {
        const content = createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
        digest.update(JSON.stringify(['file', relative, content]));
      } else throw new Error(`Unsupported item in folder: ${relative}`);
    }
  }
  await visit(root, '');
  return `folder-sha256:${digest.digest('hex')}`;
}

export class VaultDeletion {
  private readonly journal: string;
  issue: { path: string; message: string } | null = null;
  constructor(root: string, private readonly resolve: (relative: string) => Promise<string>, private readonly trash: (absolute: string) => Promise<void>) {
    this.journal = path.join(root, '.yantra', 'deletion.json');
  }

  async begin(record: DeletionRecord): Promise<void> {
    await atomicCreate(this.journal, `${JSON.stringify(deletionSchema.parse(record), null, 2)}\n`);
    vaultTrace.record('deletion.journal.created', { operation: vaultTraceOperation.getStore() });
    await this.resume();
  }

  async resume(): Promise<void> {
    this.issue = null;
    let relative = '';
    try {
      let raw: string;
      try {
        if ((await fs.lstat(this.journal)).isSymbolicLink()) throw new Error('Recovery record cannot be a symbolic link.');
        raw = await fs.readFile(this.journal, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
      const record = deletionSchema.parse(JSON.parse(raw));
      vaultTrace.record('deletion.recovery.start', { operation: vaultTraceOperation.getStore() });
      relative = record.path;
      if (record.kind !== 'folder' && !record.path.endsWith(FILE_EXTENSIONS[record.kind])) throw new Error('Invalid deletion file extension.');
      let source: string;
      try { source = await this.resolve(record.path); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        throw new Error('Deletion source is missing. It may be in Trash or moved externally; check its location before recovery. The operation record has been retained.');
      }
      const checkSource = async () => {
        if (record.kind === 'folder') {
          if (record.original === '') {
            // Existing journals only allowed empty folders.
            if (!(await fs.lstat(source)).isDirectory() || (await fs.readdir(source)).length) throw new Error('Folder is no longer empty.');
          } else if (await folderDeletionFingerprint(source) !== record.original) {
            throw new Error('Folder contents changed externally. Recovery stopped without deleting the folder.');
          }
        } else if (await fs.readFile(source, 'utf8') !== record.original) {
          throw new Error('The file changed externally. Recovery stopped without deleting it.');
        }
      };
      await checkSource();
      // Replays are idempotent: only exact before/after bytes are accepted.
      for (const canvas of record.canvases) {
        const absolute = await this.resolve(canvas.path);
        const current = await fs.readFile(absolute, 'utf8');
        if (current === canvas.after) continue;
        if (current !== canvas.before) throw new Error(`Canvas changed externally: ${canvas.path}. No recovery overwrite was made.`);
        await atomicWrite(absolute, canvas.after);
        vaultTrace.record('deletion.reference.removed', { operation: vaultTraceOperation.getStore() });
      }
      await checkSource();
      await this.trash(source);
      vaultTrace.record('deletion.trashed', { operation: vaultTraceOperation.getStore() });
      await fs.unlink(this.journal);
      vaultTrace.record('deletion.recovery.finish', { operation: vaultTraceOperation.getStore(), outcome: 'success' });
    } catch (error) {
      vaultTrace.record('deletion.recovery.finish', { operation: vaultTraceOperation.getStore(), outcome: 'recovery-required', code: 'recovery-required' });
      this.issue = { path: relative, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
