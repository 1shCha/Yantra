import { expect, it, vi } from 'vitest';
import { loadRenderer } from './renderer-loader';

it.each([
  { isPackaged: true, development: true },
  { isPackaged: true, development: false },
  { isPackaged: false, development: false },
])('loads the built renderer directly for %j', async (mode) => {
  const window = { loadURL: vi.fn(), loadFile: vi.fn() };
  await loadRenderer(window, { ...mode, filePath: '/app/dist/index.html' });
  expect(window.loadURL).not.toHaveBeenCalled();
  expect(window.loadFile).toHaveBeenCalledWith('/app/dist/index.html');
});
it('uses the dev server only with explicit opt-in on an unpackaged app', async () => {
  const window = { loadURL: vi.fn(), loadFile: vi.fn() };
  await loadRenderer(window, { isPackaged: false, development: true, filePath: '/app/dist/index.html' });
  expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173');
  expect(window.loadFile).not.toHaveBeenCalled();
});
it('falls back to the built renderer when development startup fails', async () => {
  const window = { loadURL: vi.fn().mockRejectedValue(new Error('Unavailable')), loadFile: vi.fn() };
  await loadRenderer(window, { isPackaged: false, development: true, filePath: '/app/dist/index.html', attempts: 1 });
  expect(window.loadFile).toHaveBeenCalledWith('/app/dist/index.html');
});
