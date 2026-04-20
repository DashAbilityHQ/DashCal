// later.js — Later / Holding sidebar state and rendering
import { attachItemChipResizeDrag } from './calendar.js';
import { showStatus } from './statusbar.js';
import {
  getItems, getActiveCalendarId, runSql, persistDb, loadItems,
  cloneItem, normalizeStoredItemColour, getDefaultItemColour, clamp,
  getItemDisplayColour,
} from './db.js';
import { getContrastText } from './settings.js';

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────
let preDragSidebarOpen = false;
let droppedIntoLater = false;

export function getPreDragSidebarOpen() { return preDragSidebarOpen; }
export function setPreDragSidebarOpen(val) { preDragSidebarOpen = val; }
export function getDroppedIntoLater() { return droppedIntoLater; }
export function setDroppedIntoLater(val) { droppedIntoLater = val; }

// ─────────────────────────────────────────
// Sidebar visibility
// ─────────────────────────────────────────
export function showLaterSidebar() {
  document.getElementById('holding-sidebar')?.classList.remove('hidden');
  document.getElementById('toolbar-later-btn')?.classList.add('hidden');
}

export function hideLaterSidebar() {
  document.getElementById('holding-sidebar')?.classList.add('hidden');
  document.getElementById('toolbar-later-btn')?.classList.remove('hidden');
}

// ─────────────────────────────────────────
// Count badge
// ─────────────────────────────────────────
export function updateLaterCount() {
  const count = getItems().filter((e) => !e.date).length;
  const label = `Later (${count})`;
  const toolbarLaterBtn = document.getElementById('toolbar-later-btn');
  if (toolbarLaterBtn) toolbarLaterBtn.textContent = label;
  const titleSpan = document.querySelector('.holding-sidebar-title');
  if (titleSpan) titleSpan.textContent = label;
}

// ─────────────────────────────────────────
// Render holding sidebar
// ctx: { openItemDialog, renderCanvas }
// ─────────────────────────────────────────
export function renderHoldingSidebar(ctx) {
  const { openItemDialog, renderCanvas } = ctx;
  const holdingItemList = document.getElementById('holding-event-list');
  if (!holdingItemList) return;
  updateLaterCount();
  holdingItemList.innerHTML = '';
  const holdingItems = getItems()
    .filter((e) => !e.date)
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (!holdingItems.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No items yet';
    holdingItemList.appendChild(empty);
    return;
  }

  holdingItems.forEach((calItem) => {
    const chip = document.createElement('div');
    chip.className = 'day-event-chip';
    const itemColour = getItemDisplayColour(calItem.user_colour);
    chip.style.background = itemColour;
    const contrastColour = getContrastText(itemColour);
    chip.style.color = contrastColour;
    chip.dataset.eventId = String(calItem.id);
    const isGlance = document.documentElement.getAttribute('data-density') === 'glance';
    chip.style.height = isGlance ? '26px' : `${clamp(Math.round(Number(calItem.display_size) || 52), 35, 420)}px`;

    const chipContent = document.createElement('div');
    chipContent.className = 'chip-content';

    const titleLine = document.createElement('div');
    titleLine.className = 'event-chip-line';
    const titleStrong = document.createElement('strong');
    titleStrong.textContent = calItem.title || '';
    titleLine.appendChild(titleStrong);

    const notes = document.createElement('div');
    notes.className = 'day-event-note';
    notes.textContent = calItem.notes || '';

    chipContent.append(titleLine, notes);
    chip.appendChild(chipContent);

    chip.draggable = true;
    chip.addEventListener('dragstart', (dragEvent) => {
      dragEvent.dataTransfer?.setData('text/plain', String(calItem.id));
      chip.classList.add('is-dragging');
      preDragSidebarOpen = true;
      droppedIntoLater = false;
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('is-dragging');
      if (!preDragSidebarOpen && !droppedIntoLater) hideLaterSidebar();
      droppedIntoLater = false;
    });

    const dimple = document.createElement('div');
    dimple.className = 'event-chip-dimple';
    dimple.style.color = contrastColour;
    dimple.textContent = '\u25be';
    attachItemChipResizeDrag(dimple, chip, calItem, { renderCanvas, renderHoldingSidebar: () => renderHoldingSidebar(ctx) });
    chip.appendChild(dimple);

    const resizeBar = document.createElement('div');
    resizeBar.className = 'event-chip-resize-bar';
    attachItemChipResizeDrag(resizeBar, chip, calItem, { renderCanvas, renderHoldingSidebar: () => renderHoldingSidebar(ctx) });
    chip.appendChild(resizeBar);

    chip.addEventListener('click', () => openItemDialog(calItem));
    holdingItemList.appendChild(chip);
  });
}

// ─────────────────────────────────────────
// Drop zone
// ctx: { renderAll, pushUndoEntryAndUpdate, rangeStart, rangeEnd, openItemDialog, renderCanvas }
// ─────────────────────────────────────────
export function setupHoldingSidebarDropZone(ctx) {
  const { renderAll, pushUndoEntryAndUpdate, openItemDialog, renderCanvas } = ctx;
  const sidebar = document.getElementById('holding-sidebar');
  if (!sidebar) return;

  sidebar.addEventListener('dragover', (dragEvent) => dragEvent.preventDefault());
  sidebar.addEventListener('dragenter', () => sidebar.classList.add('drop-target'));
  sidebar.addEventListener('dragleave', (dragEvent) => {
    const relatedTarget = dragEvent.relatedTarget;
    if (relatedTarget instanceof Node && sidebar.contains(relatedTarget)) return;
    sidebar.classList.remove('drop-target');
  });
  sidebar.addEventListener('drop', (dragEvent) => {
    dragEvent.preventDefault();
    sidebar.classList.remove('drop-target');
    const rawId = dragEvent.dataTransfer?.getData('text/plain');
    const itemId = Number(rawId);
    if (!itemId) return;

    droppedIntoLater = true;
    const beforeItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === itemId));
    if (!beforeItem) return;
    if (!beforeItem.date) return; // already in holding

    runSql('UPDATE events SET date = ? WHERE id = ?;', ['', itemId]);
    persistDb();
    loadItems();
    const afterItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === itemId));
    if (afterItem) {
      pushUndoEntryAndUpdate({ type: 'item_edit', before: beforeItem, after: afterItem });
    }
    renderAll();
    renderHoldingSidebar({ openItemDialog, renderCanvas });
    showStatus('Item moved to Later');
  });
}

