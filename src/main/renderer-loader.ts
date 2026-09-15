interface RendererWindow {
  loadURL: (url: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
}

interface RendererLoadOptions {
  isPackaged: boolean;
  development: boolean;
  filePath: string;
  attempts?: number;
}

export async function loadRenderer(window: RendererWindow, options: RendererLoadOptions): Promise<void> {
  if (!options.isPackaged && options.development) {
    for (let attempt = 0; attempt < (options.attempts ?? 40); attempt += 1) {
      try {
        await window.loadURL('http://127.0.0.1:5173');
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  await window.loadFile(options.filePath);
}
