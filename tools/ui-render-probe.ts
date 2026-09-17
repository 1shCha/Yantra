import { useEffect } from 'react';

type Counts = { renders: number; mounts: number; unmounts: number };
declare global { interface Window { uiRenderProbe: { reset(): void; snapshot(): Record<string, Counts> } } }
let counts: Record<string, Counts> = {};
function entry(key: string) { return counts[key] ??= { renders: 0, mounts: 0, unmounts: 0 }; }
window.uiRenderProbe = { reset() { counts = {}; }, snapshot: () => structuredClone(counts) };
// Injected only into the dedicated regression build. Count function calls and
// lifecycle effects separately; unchanged DOM alone cannot prove render isolation.
export function useRenderProbe(component: string, id = '') {
  const key = `${component}:${id}`;
  entry(key).renders++;
  useEffect(() => {
    entry(key).mounts++;
    return () => { entry(key).unmounts++; };
  }, []);
}
