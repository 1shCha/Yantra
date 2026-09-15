import type { BrowserWindow } from 'electron';

export function editorDriver(win: BrowserWindow) {
  const evaluate = (script: string) => win.webContents.executeJavaScript(script);
  const wait = async (script: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${script}\n${await evaluate('document.body.innerText')}`);
  };
  const click = (label: string) => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}).click()`);
  const edit = (script: string) => evaluate(`(() => { const editor = document.querySelector('[contenteditable=true]').editor; ${script} })()`);
  return { evaluate, wait, click, edit };
}
