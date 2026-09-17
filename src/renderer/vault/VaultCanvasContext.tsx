import { createContext } from 'react';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';

export const VaultCanvasContext = createContext<{ workspace: ReturnType<typeof createVaultWorkspace>; canvasId: string } | null>(null);
