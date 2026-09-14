import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  return writeFileAtomically(filePath, content, false);
}

export async function atomicCreate(filePath: string, content: string): Promise<void> {
  return writeFileAtomically(filePath, content, true);
}

async function writeFileAtomically(filePath: string, content: string, exclusive: boolean): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const file = await fs.open(temporaryPath, 'wx');
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    if (exclusive) await fs.link(temporaryPath, filePath);
    else await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}
