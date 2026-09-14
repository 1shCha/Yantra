import fs from 'node:fs/promises';
import path from 'node:path';
import { OperationError } from '../shared/operation-result';

// All user-visible vault paths pass through this Electron-side safety boundary.
export class VaultFileAccess {
  constructor(readonly root: string) {}
  async resolve(relative: string): Promise<string> {
    if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((part) => part === '..' || part === '.yantra' || part === '.')) {
      throw new OperationError({ code: 'invalid-input', message: 'Invalid vault path.' });
    }
    let current = this.root;
    for (const part of relative.split('/').filter(Boolean)) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new OperationError({ code: 'invalid-input', message: 'Symbolic links are not supported in vault paths.' });
    }
    return current;
  }

  async read(relative: string): Promise<string> {
    return fs.readFile(await this.resolve(relative), 'utf8');
  }
}
