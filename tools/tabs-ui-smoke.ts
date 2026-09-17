import { once } from 'node:events';
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerVaultIpcHandlers } from '../src/main/vault-ipc';
import { VaultRepository } from '../src/main/vault-repository';
import { createWindow } from '../src/main/window';
import { z } from 'zod';
import { editorDriver } from './test-support/editor-driver';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yantra-tabs-'));
  const userData = path.join(root, 'user-data');
  const vault = path.join(root, 'Tabs vault');
  await fs.mkdir(userData); await fs.mkdir(vault);
  app.setPath('userData', userData);
  await app.whenReady();
  const repo = await VaultRepository.open(vault, true);
  const docs: string[] = [];
  for (const title of ['Notes', 'Ideas', 'Reading']) {
    const file = await repo.createDocument('');
    const renamed = await repo.renameEntry(file.path, title, title);
    const document = await repo.readDocument(renamed.to);
    await repo.saveDocument({ ...document, doc: { ...document.doc, content: [...(document.doc.content ?? []), { type: 'paragraph' }] } });
    docs.push(renamed.to);
  }
  await repo.createFolder('', 'Research');
  const nested = await repo.createDocument('Research');
  const canvas = await repo.createCanvas('');
  const note = await repo.readDocument(docs[0]!);
  const nodeId = crypto.randomUUID();
  await repo.saveCanvas({ ...canvas.canvas, nodes: [{ id: nodeId, kind: 'document', documentId: note.id, x: 160, y: 160, width: 320, height: 240 }], layerOrder: [nodeId] });
  await fs.writeFile(path.join(userData, 'vault-preferences.json'), JSON.stringify({ lastVault: vault }));
  registerVaultIpcHandlers();
  delete process.env.YANTRA_DEV_SERVER;
  createWindow();
  const win = BrowserWindow.getAllWindows()[0]!;
  await once(win.webContents, 'did-finish-load');
  const driver = editorDriver(win);
  const { click } = driver;
  const wait = async (script: string) => {
    try { await driver.wait(script); }
    catch (error) { console.error('Failed renderer wait:', script); throw error; }
  };
  const evaluate = async (script: string) => {
    try { return await driver.evaluate(script); }
    catch (error) { console.error('Failed renderer check:', script); throw error; }
  };
  const row = (file: string, parent = '.vault-navigation') => parent + ' [data-path="' + file + '"]';
  const query = (selector: string) => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const open = (file: string) => evaluate(query(row(file)) + '.click()');
  const selected = query('[role="tab"][aria-selected="true"]');
  const editor = query('.vault-tab-pane[aria-hidden="false"] [contenteditable=true]') + '.editor';
  // SAFETY: The dedicated ui-regressions build installs window.uiRenderProbe with this serializable snapshot shape.
  const renderCounts = () => evaluate('window.uiRenderProbe.snapshot()') as Promise<Record<string, {renders: number; mounts: number; unmounts: number}>>;
  const resourceId = async (file: string) => z.string().min(1).parse(await evaluate(query(row(file)) + '?.dataset.resourceId'));
  function assertNoRemounts(counts: Awaited<ReturnType<typeof renderCounts>>) {
    for (const [component, count] of Object.entries(counts)) {
      assert.equal(count.mounts, 0, component + ' must not remount during rename');
      assert.equal(count.unmounts, 0, component + ' must not unmount during rename');
    }
  }
  const count = () => evaluate('document.querySelectorAll("[role=tab]").length');
  async function assertCanvasGrid(expectedCanvases: number) {
    const background = await evaluate(`(() => {
      const panes = [...document.querySelectorAll('.vault-tab-pane.vault-canvas-view')];
      const ids = panes.map(pane => pane.querySelector('.react-flow__background pattern')?.id);
      const fills = panes.map(pane => pane.querySelector('.react-flow__background rect')?.getAttribute('fill'));
      const bounds = panes.map(pane => { const r = pane.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const active = document.querySelector('.vault-tab-pane.vault-canvas-view[aria-hidden="false"] .react-flow').getBoundingClientRect();
      return { ids, fills, bounds, crop: { x: Math.round(active.left + 50), y: Math.round(active.top + 100), width: 120, height: 120 } };
    })()`);
    assert.equal(background.ids.length, expectedCanvases);
    assert.equal(new Set(background.ids).size, expectedCanvases, 'Each mounted canvas must own a unique SVG pattern');
    background.ids.forEach((id: string, index: number) => assert.equal(background.fills[index], `url(#${id})`));
    for (const bounds of background.bounds) assert.deepEqual(bounds, background.bounds[0], 'Inactive canvas bounds must match the active pane');
    const bitmap = (await win.webContents.capturePage(background.crop)).toBitmap();
    const colors = new Set<string>();
    for (let i = 0; i < bitmap.length; i += 4) colors.add(bitmap.subarray(i, i + 4).toString('hex'));
    assert.ok(colors.size > 1, 'Active canvas must paint grid pixels');
  }
  async function assertInactiveCanvasNodesHidden() {
    const leaked = await evaluate(`(() => [...document.querySelectorAll('.vault-tab-pane--inactive .react-flow__node')].map((node) => ({
      visibility: getComputedStyle(node).visibility,
      id: node.getAttribute('data-id'),
    })))()`);
    assert.ok(leaked.length > 0, 'Inactive canvas must keep its nodes mounted');
    for (const node of leaked) {
      assert.equal(node.visibility, 'hidden', 'Inactive canvas nodes must not paint into other tabs');
    }
  }
  await wait('!!' + query(row(docs[0]!)));
  const notesId = await resourceId(docs[0]!);
  const ideasId = await resourceId(docs[1]!);
  const canvasRowId = await resourceId(canvas.path);
  await open(docs[0]!);
  await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] [contenteditable=true]'));
  await evaluate('window.__tabsEditor = ' + editor + '; window.__tabsEditor.commands.insertContentAt(window.__tabsEditor.state.doc.content.size - 1, "Keep my undo");');
  await open(docs[1]!); await wait(selected + '.textContent === "Ideas"');
  await open(docs[0]!);
  assert.equal(await count(), 2);
  assert.equal(await evaluate(editor + ' === window.__tabsEditor'), true);
  assert.equal(await evaluate('window.__tabsEditor.can().undo()'), true);
  await open(docs[1]!);
  await evaluate('(() => { const row = ' + query(row(docs[2]!)) + '; for (const [type,detail] of [["click",1],["click",2],["dblclick",2]]) row.dispatchEvent(new MouseEvent(type,{bubbles:true, detail})); })()');
  await wait(selected + '.textContent === "Reading"');
  assert.equal(await count(), 2);
  await open(canvas.path); await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] .react-flow'));
  assert.equal(await count(), 3);
  const header = await evaluate('(() => { const pane = ' + query('.vault-tab-pane[aria-hidden="false"]') + '; return {header:pane.querySelector(".vault-file-header").getBoundingClientRect().top, canvas:pane.querySelector(".react-flow").getBoundingClientRect().top}; })()');
  assert.equal(header.header, header.canvas);
  await evaluate(query('.vault-tab-pane[aria-hidden="false"] .react-flow__controls-zoomin') + '.click()');
  await new Promise(resolve => setTimeout(resolve, 400));
  const transform = await evaluate(query('.vault-tab-pane[aria-hidden="false"] .react-flow__viewport') + '.style.transform');
  const tabOrder = () => evaluate('Array.from(document.querySelectorAll("[role=tab]")).map(tab => tab.dataset.fileId)');
  const originalOrder = await tabOrder();
  async function dragTab(from: number, to: number, cancel = false, measureReorder = false) {
    await wait('Array.from(document.querySelectorAll(".vault-tab")).every(tab => Math.abs(new DOMMatrix(getComputedStyle(tab).transform).m41) < .5)');
    const points = await evaluate('Array.from(document.querySelectorAll("[role=tab]")).map(tab => { const r=tab.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })');
    win.webContents.sendInputEvent({ type: 'mouseMove', ...points[from] });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points[from] });
    win.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], ...points[to] });
    await wait('!!document.querySelector("[data-tab-dragging] [role=tab][aria-selected=true]")');
    if (measureReorder) await evaluate('window.uiRenderProbe.reset()');
    await new Promise(resolve => setTimeout(resolve, 60));
    if (cancel) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points[to] });
    await wait('!document.querySelector("[data-tab-dragging]")');
    // Finish the release/click event cycle before starting another interaction.
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  }
  await dragTab(0, 2, false, true);
  assert.deepEqual(await tabOrder(), [originalOrder[1], originalOrder[2], originalOrder[0]]);
  assert.equal(await evaluate(selected + '.dataset.fileId'), originalOrder[0], 'Dragging activates the dragged tab');
  assert.equal(await evaluate(editor + ' === window.__tabsEditor'), true, 'The dragged document becomes visible immediately');
  assert.equal(await evaluate(query('.vault-tab-pane .react-flow__viewport') + '.style.transform'), transform);
  assert.equal(await evaluate('window.__tabsEditor.can().undo()'), true);
  const dragCounts = await renderCounts();
  assert.ok(dragCounts['tab-bar:']?.renders > 0, 'Reordering must update the tab strip');
  assertNoRemounts(dragCounts);
  for (const [component, counts] of Object.entries(dragCounts)) {
    if (/^(document:|canvas-node:|canvas-surface)/.test(component)) assert.equal(counts.renders, 0, component + ' must not render during tab reorder');
  }
  await dragTab(2, 0, true);
  assert.deepEqual(await tabOrder(), [originalOrder[1], originalOrder[2], originalOrder[0]], 'Escape cancels the preview');
  await dragTab(2, 0);
  assert.deepEqual(await tabOrder(), originalOrder);
  async function checkLeadingEdgeSwap(from: number, direction: number) {
    await wait('Array.from(document.querySelectorAll(".vault-tab")).every(tab => Math.abs(new DOMMatrix(getComputedStyle(tab).transform).m41) < .5)');
    const neighbor = from + direction;
    const geometry = await evaluate('Array.from(document.querySelectorAll(".vault-tab")).map(tab => { const r=tab.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,y:Math.round(r.top+r.height/2)}; })');
    const source = geometry[from];
    const target = geometry[neighbor];
    const x = Math.round(source.left + source.width / 2);
    const crossing = target.left + target.width / 2 - (direction > 0 ? source.right : source.left);
    const step = geometry[1].left - geometry[0].left;
    const shiftedMiddle = target.left + target.width / 2 - direction * step;
    const reverseCrossing = shiftedMiddle - (direction > 0 ? source.left : source.right);
    const neighborOffset = 'parseFloat(document.querySelectorAll(".vault-tab")[' + neighbor + '].style.transform.slice(11))';
    async function moveBy(delta: number) {
      win.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], x: Math.round(x + delta), y: source.y });
      // Wait for the drag transform to prove this pointer position has been processed.
      try {
        await wait('Math.abs(parseFloat(document.querySelectorAll(".vault-tab")[' + from + '].style.transform.slice(11)) - ' + Math.round(delta) + ') < 1');
      } catch (error) {
        console.error('Drag state', await evaluate('({ tabs:Array.from(document.querySelectorAll(".vault-tab")).map(t=>({transform:t.style.transform,rect:t.getBoundingClientRect().toJSON(),dragging:t.dataset.tabDragging})), active:document.activeElement?.outerHTML?.slice(0,150) })'));
        throw error;
      }
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y: source.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y: source.y });
    await moveBy(crossing - direction * 3);
    assert.equal(await evaluate(neighborOffset), 0, 'No swap before the leading edge crosses the midpoint');
    await moveBy(crossing + direction * 3);
    assert.equal(await evaluate(neighborOffset), -direction * step, 'Neighbor slides immediately when the leading edge crosses');
    await moveBy(reverseCrossing + direction * 1);
    assert.equal(await evaluate(neighborOffset), -direction * step, 'Reversing retains the slot until the opposite edge crosses');
    await moveBy(reverseCrossing - direction * 3);
    assert.equal(await evaluate(neighborOffset), 0, 'Opposite leading edge swaps back across the shifted neighbor midpoint');
    await moveBy(crossing + direction * 3);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(x + crossing + direction * 3), y: source.y });
    await wait('!document.querySelector("[data-tab-dragging]")');
    // Finish the release/click event cycle before starting another interaction.
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
    const expected = [...originalOrder];
    [expected[from], expected[neighbor]] = [expected[neighbor], expected[from]];
    assert.deepEqual(await tabOrder(), expected, 'Dropping commits the edge-triggered preview order');
    await dragTab(neighbor, from);
    assert.deepEqual(await tabOrder(), originalOrder);
  }
  await checkLeadingEdgeSwap(0, 1);
  await checkLeadingEdgeSwap(2, -1);
  await open(docs[0]!);
  await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] [contenteditable=true]'));
  assert.equal(await evaluate(editor + ' === window.__tabsEditor'), true, 'Dragging preserves the document editor instance');
  await assertInactiveCanvasNodesHidden();
  await open(canvas.path);
  assert.equal(await evaluate(query('.vault-tab-pane[aria-hidden="false"] .react-flow__viewport') + '.style.transform'), transform);
  await evaluate(query('.vault-tab-pane[aria-hidden="false"] .markdown-node__body') + '.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
  await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] [contenteditable=true]'));
  await evaluate(editor + '.commands.insertContentAt(' + editor + '.state.doc.content.size - 1, "Changed from canvas");');
  await open(docs[0]!);
  await wait(editor + '.getText().includes("Changed from canvas")');
  await assertInactiveCanvasNodesHidden();
  await open(canvas.path);
  await click('Open a file or create a tab');
  await wait(query('#vault-tab-picker') + '.matches(":popover-open") && !!' + query('#vault-tab-picker .vault-sidebar'));
  await evaluate(query(row('Research', '#vault-tab-picker')) + '.click()');
  await wait('!!' + query(row(nested.path, '#vault-tab-picker')));
  assert.ok(await evaluate('parseFloat(getComputedStyle(' + query('#vault-tab-picker .vault-sidebar') + ').paddingTop)') < 10);
  assert.equal(await evaluate('!!' + query(row(nested.path))), false);
  assert.equal(await evaluate('!!' + query('#vault-tab-picker [aria-label="New Folder"]')), false);
  await fs.writeFile('/tmp/yantra-tabs-picker.png', (await win.webContents.capturePage()).toPNG());
  await evaluate(query(row(nested.path, '#vault-tab-picker')) + '.click()');
  await wait('!' + query('#vault-tab-picker') + '.matches(":popover-open")');
  assert.equal(await count(), 4);
  await click('Open a file or create a tab');
  await wait(query('#vault-tab-picker') + '.matches(":popover-open") && !!' + query('#vault-tab-picker .vault-sidebar'));
  await evaluate(query('#vault-tab-picker [aria-label="New Canvas"]') + '.click()');
  await wait('document.querySelectorAll("[role=tab]").length === 5');
  const secondCanvasId = await evaluate(selected + '.dataset.fileId');
  await assertCanvasGrid(2);
  assert.equal(await evaluate(selected + '.getAttribute("title").includes("/")'), false);
  await evaluate(selected + '.focus()');
  const beforeKeyboardReorder = await tabOrder();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt', 'shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt', 'shift'] });
  await wait('document.querySelectorAll("[role=tab]")[3].getAttribute("aria-selected") === "true"');
  assert.deepEqual(await tabOrder(), [...beforeKeyboardReorder.slice(0, 3), beforeKeyboardReorder[4], beforeKeyboardReorder[3]]);
  const beforeReload = await evaluate(selected + '.textContent');
  const orderBeforeReload = await tabOrder();
  await new Promise(resolve => setTimeout(resolve, 700));
  win.reload();
  await wait('document.querySelectorAll("[role=tab]").length === 5 && !!' + query('.vault-tab-pane[aria-hidden="false"] .react-flow'));
  assert.equal(await evaluate(selected + '.textContent'), beforeReload);
  assert.deepEqual(await tabOrder(), orderBeforeReload);
  await click('Yantra — close sidebar');
  await new Promise(resolve => setTimeout(resolve, 400));
  const bounds = await evaluate('(() => { const r=document.querySelector(".app-shell__tabs").getBoundingClientRect(); const l=document.querySelector(".app-shell__notch").getBoundingClientRect(); const right=document.querySelector(".app-shell__notch--right").getBoundingClientRect(); return {left:r.left,right:r.right,l:l.right,r:right.left}; })()');
  assert.ok(bounds.left >= bounds.l && bounds.right <= bounds.r);
  await fs.writeFile('/tmp/yantra-tabs-collapsed.png', (await win.webContents.capturePage()).toPNG());
  await click('Open right sidebar');
  win.setSize(900, 620);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(await evaluate(query('.vault-tabs__list') + '.scrollWidth > ' + query('.vault-tabs__list') + '.clientWidth'));
  assert.ok(await evaluate('(() => { const a=' + query('.vault-tabs__add') + '.getBoundingClientRect(); const s=' + query('.app-shell__sidebar--right') + '.getBoundingClientRect(); return a.right <= s.left; })()'));
  const addMatch = await evaluate('(() => { const add=' + query('.vault-tabs__add') + '; const close=' + query('.vault-tab--active .vault-tab__close') + '; const addIcon=add.querySelector("svg").getBoundingClientRect(); const closeIcon=close.querySelector("svg").getBoundingClientRect(); const a=add.getBoundingClientRect(); const c=close.getBoundingClientRect(); return {button: Math.abs(a.width-c.width) < 1 && Math.abs(a.height-c.height) < 1, icon: Math.abs(addIcon.width-closeIcon.width) < 1 && Math.abs(addIcon.height-closeIcon.height) < 1}; })()');
  assert.ok(addMatch.button, 'Add-tab control must match the close-tab button size');
  assert.ok(addMatch.icon, 'Add-tab icon must match the close-tab X size');
  const beforeEdgeDrag = await tabOrder();
  const draggedEdgeId = beforeEdgeDrag[0];
  const edgePoints = await evaluate('(() => { const list=document.querySelector(".vault-tabs__list"); list.scrollLeft=0; const r=list.getBoundingClientRect(); const tab=list.querySelector("[role=tab]").getBoundingClientRect(); return {start:{x:Math.round(tab.left+20),y:Math.round(tab.top+14)},end:{x:Math.round(r.right-2),y:Math.round(r.top+14)}}; })()');
  win.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', ...edgePoints.start });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...edgePoints.start });
  win.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], ...edgePoints.end });
  await wait('!!document.querySelector("[data-tab-dragging]")');
  await wait('document.querySelector(".vault-tabs__list").scrollLeft > 50');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 80));
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...edgePoints.end });
  await wait('!document.querySelector("[data-tab-dragging]")');
  assert.deepEqual(await tabOrder(), beforeEdgeDrag, 'Cancel after edge scrolling preserves order');
  assert.equal(await evaluate(selected + '.dataset.fileId'), draggedEdgeId, 'Cancel preserves activation of the dragged tab');
  await evaluate(selected + '.focus()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
  await wait(selected + '.textContent === "Notes"');
  const nameInput = query('.vault-tab-pane[aria-hidden="false"] .vault-file-header__name-input');
  const draftName = async (name: string) => {
    await evaluate('(() => { const input = ' + nameInput + '; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ' + JSON.stringify(name) + '); input.dispatchEvent(new Event("input", {bubbles:true})); })()');
  };
  const checkGrowingName = async () => {
    await evaluate('window.uiRenderProbe.reset()');
    const initialWidth = await evaluate(nameInput + '.getBoundingClientRect().width');
    await draftName('A longer name for this file');
    await wait(nameInput + '.getBoundingClientRect().width > ' + initialWidth);
    // Real typing exercises the browser's caret scrolling when the header runs out of room.
    await evaluate(nameInput + '.focus(); ' + nameInput + '.select()');
    await win.webContents.insertText('W'.repeat(150));
    await win.webContents.insertText('Z');
    await wait(nameInput + '.value.endsWith("Z")');
    const field = await evaluate('(() => { const i=' + nameInput + '; const r=i.getBoundingClientRect(); const h=i.closest("header").getBoundingClientRect(); return {length:i.value.length,end:i.selectionEnd,scroll:i.scrollLeft,client:i.clientWidth,total:i.scrollWidth,right:r.right,headerRight:h.right,focused:document.activeElement===i}; })()');
    assert.equal(field.length, 151, 'Long names must retain every typed character');
    assert.equal(field.end, 151);
    assert.ok(field.focused);
    assert.ok(field.right <= field.headerRight, 'Name must stay within its header');
    assert.ok(field.scroll > 0 && field.total - field.client - field.scroll <= 3, 'Typing must keep the end of an overflowing name visible');
    const typing = await renderCounts();
    assert.ok(Object.keys(typing).some(component => component.startsWith('header:')), 'Render probes must observe the edited header');
    for (const [component, count] of Object.entries(typing)) {
      if (!component.startsWith('header:')) assert.equal(count.renders, 0, component + ' must not render while typing a header name');
    }
    assertNoRemounts(typing);
    await draftName('');
    assert.ok(await evaluate(nameInput + '.getBoundingClientRect().width > 0'), 'Empty name must retain a visible editing area');
  };
  const key = (keyCode: string) => {
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  await evaluate(editor + '.commands.insertContentAt(' + editor + '.state.doc.content.size - 1, " Rename history check.")');
  assert.ok(await evaluate(editor + '.can().undo()'), 'Body edit must create undo history before renaming');
  const nameBounds = await evaluate('(() => { const r=' + query('.vault-tab-pane[aria-hidden="false"] .vault-file-header__rename') + '.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()');
  await click('Rename document');
  await wait('!!' + nameInput);
  const editBounds = await evaluate('(() => { const input=' + nameInput + '; const r=input.getBoundingClientRect(); const css=getComputedStyle(input); return {x:r.x,y:r.y,width:r.width,height:r.height,border:css.borderTopWidth,background:css.backgroundColor,outline:css.outlineStyle}; })()');
  for (const dimension of ['x', 'y', 'height']) assert.ok(Math.abs(nameBounds[dimension] - editBounds[dimension]) < 1, 'Inline name must not shift: ' + dimension);
  assert.ok(editBounds.width >= nameBounds.width, 'Editing must provide at least the displayed name width');
  assert.equal(editBounds.border, '0px');
  assert.equal(editBounds.background, 'rgba(0, 0, 0, 0)');
  assert.equal(editBounds.outline, 'none');
  assert.equal(await evaluate('!!' + query('.vault-dialog[open]')), false);
  assert.equal(await evaluate(nameInput + '.selectionEnd - ' + nameInput + '.selectionStart'), 'Notes'.length);
  await checkGrowingName();
  await draftName('Cancelled by blur');
  await evaluate(query('.vault-document-scroll') + '.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true}))');
  await wait('!' + nameInput);
  assert.equal(await evaluate(selected + '.textContent'), 'Notes');
  await click('Rename document');
  await draftName('Cancelled by escape'); key('Escape');
  await wait('!' + nameInput);
  assert.equal(await evaluate(selected + '.textContent'), 'Notes');
  await click('Rename document');
  await draftName('Invalid/name');
  await wait('!!' + query('.vault-file-header__name-error'));
  key('Enter');
  await wait(nameInput + '.value === "Notes"');
  assert.equal(await evaluate(selected + '.textContent'), 'Notes');
  await draftName('Reading'); key('Enter');
  await wait(nameInput + '.value === "Notes"');
  assert.ok(await evaluate(query('.vault-file-header__name-error') + '.textContent.includes("already exists")'));
  await evaluate('void (window.__renameEditor = ' + editor + ')');
  await evaluate('window.__renameRowChanges = 0; window.__renameObserver = new MutationObserver(records => window.__renameRowChanges += records.length); window.__renameObserver.observe(' + query(row(docs[1]!)) + ', {attributes:true,childList:true,subtree:true,characterData:true});');
  await evaluate('window.uiRenderProbe.reset()');
  await draftName('Header notes'); key('Enter');
  await wait('!' + nameInput);
  await wait(selected + '.textContent === "Header_notes"');
  assert.ok(await evaluate(editor + '.getText().startsWith("Header notes")'));
  assert.equal(await evaluate(editor + ' === window.__renameEditor'), true, 'Renaming must retain the document editor');
  assert.ok(await evaluate(editor + '.can().undo()'), 'Renaming must preserve body edit history');
  assert.equal(await evaluate('window.__renameRowChanges'), 0, 'Unrelated sidebar rows must not flash or change during rename');
  await evaluate('window.__renameObserver.disconnect()');
  const documentRename = await renderCounts();
  console.log('Document rename render counts', documentRename);
  assertNoRemounts(documentRename);
  assert.equal(documentRename['canvas-surface:']?.renders ?? 0, 0, 'Renaming a document must not render canvas geometry');
  assert.equal(documentRename['row:' + ideasId]?.renders ?? 0, 0, 'Unrelated sidebar rows must not render');
  assert.ok(documentRename['row:' + notesId]?.renders, 'The renamed row must update');
  assert.equal(documentRename['tab:' + ideasId]?.renders ?? 0, 0, 'Unrelated tabs must not render');
  assert.ok(documentRename['tab:' + notesId]?.renders, 'The renamed tab must update');
  assert.equal(await resourceId('Header_notes.yantraD'), notesId, 'Renaming must keep the sidebar row identity');
  assert.ok(await fs.stat(path.join(vault, 'Header_notes.yantraD')));
  assert.ok(await evaluate('!!' + query(row('Header_notes.yantraD'))));
  await evaluate(query('[role="tab"][title="' + canvas.path + '"]') + '.click()');
  await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] .react-flow'));
  assert.ok(await evaluate('(() => { const button=' + query('.vault-tab-pane[aria-hidden="false"] .vault-file-header__rename') + '; const r=button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()'));
  await click('Rename canvas');
  await wait('!!' + nameInput);
  await checkGrowingName();
  await new Promise(resolve => setTimeout(resolve, 150));
  await evaluate('window.uiRenderProbe.reset()');
  await draftName('Workspace_canvas'); key('Enter');
  await wait('!' + nameInput);
  await wait(selected + '.textContent === "Workspace_canvas"');
  const canvasRename = await renderCounts();
  console.log('Canvas rename render counts', canvasRename);
  assertNoRemounts(canvasRename);
  for (const [component, count] of Object.entries(canvasRename)) {
    if (component.startsWith('document:') || component.startsWith('canvas-node:') || component === 'canvas-surface:' || component === 'header:document' || component === 'row:' + notesId || component === 'tab:' + notesId) {
      assert.equal(count.renders, 0, component + ' must not render for a canvas rename');
    }
  }
  assert.ok(canvasRename['row:' + canvasRowId]?.renders, 'The renamed canvas row must update');
  assert.ok(canvasRename['tab:' + canvasRowId]?.renders, 'The renamed canvas tab must update');
  assert.equal(await resourceId('Workspace_canvas.yantraC'), canvasRowId, 'Renaming must keep the canvas row identity');
  assert.ok(await fs.stat(path.join(vault, 'Workspace_canvas.yantraC')));
  await click('Open a file or create a tab');
  await wait(query('#vault-tab-picker') + '.matches(":popover-open") && !!' + query('#vault-tab-picker .vault-sidebar'));
  assert.ok(await evaluate('!!' + query(row('Workspace_canvas.yantraC', '#vault-tab-picker'))));
  assert.ok(await evaluate('!!' + query(row('Header_notes.yantraD', '#vault-tab-picker'))));
  await evaluate(query('#vault-tab-picker') + '.hidePopover()');
  await evaluate(query('.vault-tab-pane[aria-hidden="false"] .markdown-node__body') + '?.dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))');
  await wait('!!' + query('.vault-tab-pane[aria-hidden="false"] [contenteditable=true]'));
  await evaluate('window.__canvasEditor = ' + editor + '; window.__canvasEditor.commands.insertContentAt(window.__canvasEditor.state.doc.content.size - 1, " canvas undo check");');
  assert.ok(await evaluate('window.__canvasEditor.can().undo()'));
  await evaluate(query('[role="tab"][data-file-id="' + secondCanvasId + '"]') + '.click()');
  await wait(selected + '.dataset.fileId === ' + JSON.stringify(secondCanvasId));
  await assertCanvasGrid(2);
  await assertInactiveCanvasNodesHidden();
  await evaluate(query('[role="tab"][data-file-id="' + canvasRowId + '"]') + '.click()');
  await wait(selected + '.dataset.fileId === ' + JSON.stringify(canvasRowId));
  assert.equal(await evaluate(editor + ' === window.__canvasEditor'), true, 'Canvas node editor must survive tab switching');
  assert.ok(await evaluate('window.__canvasEditor.can().undo()'), 'Canvas node undo history must survive tab switching');
  await evaluate(query('.vault-navigation [aria-label="New Canvas"]') + '.click()');
  await wait('document.querySelectorAll("[role=tab]").length === 6');
  await assertCanvasGrid(3);
  for (let remaining = 6; remaining > 0; remaining--) {
    await evaluate(query('.vault-tab--active .vault-tab__close') + '.click()');
    await wait('document.querySelectorAll("[role=tab]").length === ' + (remaining - 1));
  }
  await wait('!!' + query('.vault-empty'));
  win.reload();
  await wait('!!' + query('.vault-navigation [data-path]'));
  assert.equal(await count(), 0);
  console.log('Tabs UI passed: navigation, editor/canvas preservation, shared picker, restoration, overflow, keyboard controls, inline header renaming, click-away/Escape cancellation, invalid-name reversion with collapsed sidebar, collisions, and disk updates.');
  win.destroy();
  await fs.rm(root, { recursive: true, force: true });
  app.quit();
}
main().catch((error) => { console.error(error); app.exit(1); });
