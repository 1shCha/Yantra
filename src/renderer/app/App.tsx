import { lazy, Suspense } from 'react';
import './install-vault-diagnostics';
import { installUiActionListener } from './ui-action-listener';

installUiActionListener();
import.meta.hot?.dispose(() => window.yantraUiDebug?.dispose?.());

import { VaultApp } from '../vault/VaultApp';

const VaultUiPreview = import.meta.env.DEV
  ? lazy(() => import('../vault-preview/VaultUiPreview'))
  : null;

export function App() {
  if (VaultUiPreview && new URLSearchParams(window.location.search).get('preview') === 'vault-ui') {
    return <Suspense fallback={null}><VaultUiPreview /></Suspense>;
  }

  return <VaultApp />;
}
