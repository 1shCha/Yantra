import { useEffect } from 'react';
import { WorkspaceFrame } from '../app/WorkspaceFrame';
import { createVaultWorkspace } from '../stores/vaultWorkspace';
import { useVaultNavigation } from './useVaultNavigation';
import { VaultTabBar } from './VaultTabBar';
import { VaultViewport } from './VaultViewport';
import '../vault-ui/vault-ui.css';
import './vault.css';
import './vault-tabs.css';

// The registry and save queue outlive editor mounts and StrictMode effect replay.
let workspace: ReturnType<typeof createVaultWorkspace> | undefined;

function VaultWorkspace({ store }: { store: ReturnType<typeof createVaultWorkspace> }) {
  const navigation = useVaultNavigation(store);
  useEffect(() => {
    void store.getState().restore();
    return window.yantraCanvas?.onBeforeClose(() => store.getState().flush());
  }, [store]);
  return <WorkspaceFrame defaultSidebarOpen sidebar={navigation.sidebar} tabs={<VaultTabBar store={store} entries={navigation.entries}
    onOpen={navigation.openFile} onCreateDocument={navigation.createDocumentAtRoot} onCreateCanvas={navigation.createCanvasAtRoot} />}>
    <VaultViewport store={store} navigation={navigation.viewport} />
    {navigation.dialogs}
  </WorkspaceFrame>;
}

export function VaultApp() {
  if (!window.yantraVault) return <WorkspaceFrame defaultSidebarOpen><div className="vault-file-state"><h1>Open Yantra in the desktop app</h1><p>Local vault access requires Electron.</p></div></WorkspaceFrame>;
  workspace ??= createVaultWorkspace(window.yantraVault);
  return <VaultWorkspace store={workspace} />;
}
