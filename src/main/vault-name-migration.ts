import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicCreate, atomicWrite } from './atomic-write';
import { documentFileSchema } from '../shared/vault-format';
import { canvasFileSchema } from '../shared/vault-canvas';
import { vaultNameSchema } from '../shared/vault-organization';

const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), from: z.string(), to: z.string(), original: z.string(), content: z.string() }).strict(),
  z.object({ kind: z.literal('folder'), from: z.string(), to: z.string() }).strict(),
]);
const journalSchema = z.object({ cursor: z.number().int().nonnegative(), operations: z.array(operationSchema) }).strict();
type Operation = z.infer<typeof operationSchema>;

function normalizedName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 180) || 'Untitled';
}

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

// Journal paths never follow links or escape the vault, including during recovery.
async function safePath(root: string, relative: string): Promise<string> {
  const parts = relative.split('/');
  if (path.isAbsolute(relative) || relative.includes('\\') || parts.some((part) => !part || part === '.' || part === '..' || part === '.yantra')) {
    throw new Error('Invalid migration path.');
  }
  let result = root;
  for (const part of parts) {
    result = path.join(result, part);
    if (await exists(result) && (await fs.lstat(result)).isSymbolicLink()) throw new Error('Migration cannot follow symbolic links.');
  }
  return result;
}

async function planMigration(root: string): Promise<Operation[]> {
  const operations: Operation[] = [];
  const walk = async (relative: string) => {
    const files = (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    const occupied = new Set(files.map((file) => file.name.toLowerCase()));
    const reserve = (base: string, extension: string) => {
      let candidate = `${base}${extension}`;
      for (let index = 2; occupied.has(candidate.toLowerCase()); index += 1) {
        const suffix = `_${index}`;
        candidate = `${base.slice(0, 180 - suffix.length)}${suffix}${extension}`;
      }
      occupied.add(candidate.toLowerCase());
      return candidate;
    };
    for (const file of files) {
      if (file.name.startsWith('.') || file.isSymbolicLink()) continue;
      const from = relative ? `${relative}/${file.name}` : file.name;
      if (file.isDirectory()) {
        await walk(from);
        if (!vaultNameSchema.safeParse(file.name).success) {
          const name = reserve(normalizedName(file.name), '');
          operations.push({ kind: 'folder', from, to: relative ? `${relative}/${name}` : name });
        }
        continue;
      }
      if (!file.isFile()) continue;
      const extension = ['.yantra_doc', '.yantra_canvas', '.yantraD', '.yantraC'].find((suffix) => file.name.endsWith(suffix));
      if (!extension) continue;
      const stem = file.name.slice(0, -extension.length);
      const nextExtension = extension === '.yantra_doc' ? '.yantraD' : extension === '.yantra_canvas' ? '.yantraC' : extension;
      if (extension === nextExtension && vaultNameSchema.safeParse(stem).success) continue;
      const name = reserve(normalizedName(stem), nextExtension);
      const title = name.slice(0, -nextExtension.length);
      const original = await fs.readFile(await safePath(root, from), 'utf8');
      let content = original;
      try {
        const input = z.object({ title: z.string() }).passthrough().parse(JSON.parse(original));
        // Only rewrite titles in understood files; malformed/future content remains byte-for-byte intact.
        if (input.title === stem) {
          const schema = nextExtension === '.yantraD' ? documentFileSchema : canvasFileSchema;
          const parsed = schema.safeParse({ ...input, title });
          if (parsed.success) content = `${JSON.stringify(parsed.data, null, 2)}\n`;
        }
      } catch { /* Keep unreadable contents intact so the normal unavailable-file UI can report them. */ }
      operations.push({ kind: 'file', from, to: relative ? `${relative}/${name}` : name, original, content });
    }
  };
  await walk('');
  return operations;
}

async function applyOperation(root: string, operation: Operation): Promise<void> {
  const from = await safePath(root, operation.from);
  const to = await safePath(root, operation.to);
  const sourceExists = await exists(from);
  const targetExists = await exists(to);
  if (operation.kind === 'file') {
    if (sourceExists && await fs.readFile(from, 'utf8') !== operation.original) throw new Error(`Migration source changed: ${operation.from}`);
    if (targetExists) {
      if (await fs.readFile(to, 'utf8') !== operation.content) throw new Error(`Migration destination changed: ${operation.to}`);
    } else {
      if (!sourceExists) throw new Error(`Migration source missing: ${operation.from}`);
      await atomicCreate(to, operation.content);
    }
    if (sourceExists) await fs.unlink(from);
  } else if (sourceExists) {
    if (!targetExists) await fs.mkdir(to);
    // A reserved empty directory is the only destination we may replace.
    if (!(await fs.lstat(to)).isDirectory() || (await fs.readdir(to)).length) throw new Error(`Migration destination occupied: ${operation.to}`);
    await fs.rename(from, to);
  } else if (!targetExists || !(await fs.lstat(to)).isDirectory()) {
    throw new Error(`Migration folder missing: ${operation.from}`);
  }
}

export async function migrateVaultNames(root: string): Promise<void> {
  const journalPath = path.join(root, '.yantra', 'name-migration.json');
  if (await exists(journalPath) && (await fs.lstat(journalPath)).isSymbolicLink()) throw new Error('Migration journal cannot be a symbolic link.');
  let journal: z.infer<typeof journalSchema>;
  if (await exists(journalPath)) {
    journal = journalSchema.parse(JSON.parse(await fs.readFile(journalPath, 'utf8')));
    if (journal.cursor > journal.operations.length) throw new Error('Invalid migration progress.');
  } else {
    journal = { cursor: 0, operations: await planMigration(root) };
    if (!journal.operations.length) return;
    // Immutable backup includes original file bytes and folder moves before any data changes.
    await atomicCreate(path.join(root, '.yantra', `name-migration-backup-${randomUUID()}.json`), `${JSON.stringify(journal, null, 2)}\n`);
    await atomicCreate(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  }
  while (journal.cursor < journal.operations.length) {
    await applyOperation(root, journal.operations[journal.cursor]!);
    journal.cursor += 1;
    await atomicWrite(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  }
  await fs.unlink(journalPath);
}
