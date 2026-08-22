import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { CanvasLoadResult, CanvasSaveResult, JsonCanvasDocument } from '../shared/canvas-api';
import {
  createEmptyJsonCanvasDocument,
  decodeJsonCanvasDocument,
  encodeJsonCanvasDocument,
} from '../shared/json-canvas';

const CANVAS_FILE_NAME = 'default.canvas';

function isMissingCanvasFileError(error: Error): error is NodeJS.ErrnoException {
  return 'code' in error && error.code === 'ENOENT';
}

export function getCanvasFilePath(): string {
  return path.join(app.getPath('userData'), CANVAS_FILE_NAME);
}

export async function loadCanvasDocument(): Promise<CanvasLoadResult> {
  const filePath = getCanvasFilePath();

  try {
    const file = await fs.readFile(filePath, 'utf8');
    const document = decodeJsonCanvasDocument(file);

    return {
      document,
      filePath,
      exists: true,
    };
  } catch (caught) {
    if (caught instanceof Error && isMissingCanvasFileError(caught)) {
      return {
        document: createEmptyJsonCanvasDocument(),
        filePath,
        exists: false,
      };
    }

    throw caught;
  }
}

export async function saveCanvasDocument(document: JsonCanvasDocument): Promise<CanvasSaveResult> {
  const validatedDocument = encodeJsonCanvasDocument(document);

  const filePath = getCanvasFilePath();
  const temporaryPath = `${filePath}.tmp`;
  const content = `${JSON.stringify(validatedDocument, null, 2)}\n`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);

  return {
    filePath,
    savedAt: new Date().toISOString(),
  };
}

export { createEmptyJsonCanvasDocument };
