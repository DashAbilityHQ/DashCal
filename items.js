// items.js — DashCal item CRUD, dialog, and push logic
import { showStatus } from './statusbar.js';
import {
  getItems, getActiveCalendarId, getDayMap, runSql, persistDb,
  loadItems, cloneItem, normalizeStoredItemColour, getDefaultItemColour, getItemDisplayColour,
  toISODate, clamp, addDaysToISODate, byItemDateTime,
  pushUndoEntry,
} from './db.js';
import { renderSwatches, getContrastText } from './settings.js';
import { updateUndoRedoButtons } from './toolbar.js';

// ─────────────────────────────────────────
// Module state
// ─────────────────────────────────────────
let activeItemColour = getDefaultItemColour();
let lastEnteredTime = '';

// ─────────────────────────────────────────
// Injected app-level callbacks
// ─────────────────────────────────────────
let _renderAll = () => {};
let _flashDayCard = () => {};
let _getSelectedDate = () => '';

export function initItems({ renderAll, flashDayCard, getSelectedDate }) {
  _renderAll = renderAll;
  _flashDayCard = flashDayCard;
  _getSelectedDate = getSelectedDate;
}

// ─────────────────────────────────────────
// State accessors
// ─────────────────────────────────────────
export function getActiveItemColour() { return activeItemColour; }
export function setActiveItemColour(val) {
  activeItemColour = val;
  const swatchRow = document.getElementById('swatch-row');
  if (swatchRow) swatchRow.dataset.activeColour = activeItemColour;
}
export function getLastEnteredTime() { return lastEnteredTime; }
export function setLastEnteredTime(val) { lastEnteredTime = val; }

// ─────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────
export function pushUndoEntryAndUpdate(entry, opts) {
  pushUndoEntry(entry, opts);
  updateUndoRedoButtons();
}

function applyEventDialogColourBar(hex) {
  const colourBar = document.getElementById('event-dialog-colour-bar');
  const colourTitle = document.getElementById('event-dialog-colour-title');
  if (!colourBar) return;
  const displayColour = getItemDisplayColour(hex);
  const contrastColour = getContrastText(displayColour);
  colourBar.style.background = displayColour;
  colourBar.style.color = contrastColour;
  if (colourTitle) colourTitle.style.color = contrastColour;
}

function syncEventDialogColourTitle() {
  const titleInput = document.getElementById('event-title');
  const colourTitle = document.getElementById('event-dialog-colour-title');
  if (!colourTitle) return;
  colourTitle.textContent = titleInput?.value || '';
}

// ─────────────────────────────────────────
// Item dialog
// ─────────────────────────────────────────

/**
 * Open the item modal.
 * Correctly loads all three states:
 *   - All-day  (is_all_day = true)
 *   - Timed    (is_all_day = false, time has value)
 *   - Untimed  (is_all_day = false, time is null/empty)
 */
export function openItemDialog(itemLike) {
  const calItem = itemLike || {};
  const editing = Boolean(calItem.id);
  const isHolding = calItem._holding === true;

  document.getElementById('event-dialog-title').textContent = editing ? 'Edit Item' : 'New Item';
  document.getElementById('event-id').value = editing ? calItem.id : '';

  const isNoDate = isHolding || (editing && !calItem.date);
  document.getElementById('event-date').value = isNoDate ? '' : (calItem.date || _getSelectedDate());

  // Restore the explicit is_all_day flag; do NOT infer all-day from absence of time
  const isAllDay = editing ? Boolean(calItem.is_all_day) : false;
  document.getElementById('event-all-day').checked = isAllDay;

  document.getElementById('event-time').value = calItem.time || '';
  lastEnteredTime = calItem.time || '';

  const titleInput = document.getElementById('event-title');
  titleInput.value = calItem.title || '';
  document.getElementById('event-notes').value = calItem.notes || '';

  applyEventDialogColourBar(calItem.user_colour);
  syncEventDialogColourTitle();
  titleInput.removeEventListener('input', syncEventDialogColourTitle);
  titleInput.addEventListener('input', syncEventDialogColourTitle);

  toggleTimeInputVisibility(isAllDay);

  activeItemColour = normalizeStoredItemColour(calItem.user_colour);
  document.getElementById('delete-event-btn').classList.toggle('hidden', !editing);
  document.getElementById('push-event-btn')?.classList.toggle('hidden', !editing);
  const swatchRow = document.getElementById('swatch-row');
  if (swatchRow) swatchRow.dataset.activeColour = activeItemColour;
  renderSwatches();
  document.getElementById('event-dialog').showModal();
}

/**
 * Save the item from the form.
 * Persists is_all_day explicitly so the three states are preserved correctly.
 */
export function saveItemFromForm() {
  const id = Number(document.getElementById('event-id').value || 0);
  const isAllDay = document.getElementById('event-all-day').checked;
  const beforeItem = id ? cloneItem(getItems().find((calItem) => Number(calItem.id) === id)) : null;
  const existingIds = new Set(getItems().map((calItem) => Number(calItem.id)));

  // When all-day, clear time. When not all-day, use whatever is in the time field.
  const timeValue = isAllDay ? '' : (document.getElementById('event-time').value || '');

  const payload = {
    date: document.getElementById('event-date').value || '',
    time: timeValue,
    is_all_day: isAllDay ? 1 : 0,
    title: document.getElementById('event-title').value.trim(),
    notes: document.getElementById('event-notes').value.trim(),
    user_colour: normalizeStoredItemColour(activeItemColour),
    display_size: id ? clamp(Math.round(Number(beforeItem?.display_size) || 52), 35, 420) : 52
  };

  if (!payload.title) return;

  if (id) {
    runSql(
      'UPDATE events SET date = ?, title = ?, time = ?, is_all_day = ?, notes = ?, user_colour = ?, display_size = ? WHERE id = ?;',
      [payload.date, payload.title, payload.time, payload.is_all_day, payload.notes, payload.user_colour, payload.display_size, id]
    );
  } else {
    runSql(
      'INSERT INTO events(date, title, time, is_all_day, notes, user_colour, display_size, calendar_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?);',
      [payload.date, payload.title, payload.time, payload.is_all_day, payload.notes, payload.user_colour, payload.display_size, getActiveCalendarId() || 0]
    );
  }

  persistDb();
  loadItems();

  if (id) {
    const afterItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === id));
    if (beforeItem && afterItem) {
      pushUndoEntryAndUpdate({ type: 'item_edit', before: beforeItem, after: afterItem });
    }
  } else {
    let addedItem = null;
    for (const calItem of getItems()) {
      const calItemId = Number(calItem.id);
      if (!existingIds.has(calItemId)) {
        addedItem = cloneItem(calItem);
        break;
      }
    }
    if (!addedItem && getItems().length) {
      const latest = [...getItems()].sort((a, b) => Number(b.id) - Number(a.id))[0];
      addedItem = cloneItem(latest);
    }
    if (addedItem) {
      pushUndoEntryAndUpdate({ type: 'item_add', item: addedItem });
    }
  }

  _renderAll();
  if (payload.date) {
    _flashDayCard(payload.date, 'flash-save');
  }
  if (id) {
    showStatus('Item saved');
  } else if (payload.date) {
    showStatus('Item scheduled');
  } else {
    showStatus('Item added to Later');
  }
}

export function openPushDialog() {
  const pushScopeSingle = document.getElementById('push-scope-single');
  const pushDaysInput = document.getElementById('push-days');
  const dialog = document.getElementById('event-dialog');
  const dialogActions = document.querySelector('#event-dialog .dialog-actions');
  const pushDialog = document.getElementById('push-dialog');
  const pushCancelBtn = document.getElementById('push-cancel-btn');
  const pushConfirmBtn = document.getElementById('push-confirm-btn');

  if (pushScopeSingle) pushScopeSingle.checked = true;
  if (pushDaysInput) pushDaysInput.value = '1';
  dialog?.classList.add('is-backgrounded');
  dialogActions?.classList.add('actions-hidden');
  pushDialog?.showModal();
  pushCancelBtn?.addEventListener('click', closePushDialog, { once: true });
  pushConfirmBtn?.addEventListener('click', executePush, { once: true });
}

export function closePushDialog() {
  document.getElementById('push-dialog')?.close();
  document.getElementById('event-dialog')?.classList.remove('is-backgrounded');
  document.querySelector('#event-dialog .dialog-actions')?.classList.remove('actions-hidden');
}

/**
 * Execute the push operation.
 *
 * "Push just this item":      add X days to the selected item only.
 * "Push all subsequent items": add X days to the selected item AND every
 *                               item in the same calendar whose start date
 *                               is on or after the selected item's date.
 *
 * After pushing: closes push modal, closes item modal, refreshes calendar.
 */
export function executePush() {
  const days = Math.max(1, parseInt(document.getElementById('push-days')?.value, 10) || 1);
  // Read scope from the radio group explicitly
  const scopeValue = document.querySelector('input[name="push-scope"]:checked')?.value || 'single';
  const scopeSingle = scopeValue === 'single';

  const itemId = Number(document.getElementById('event-id').value || 0);
  if (!itemId) { closePushDialog(); return; }

  const targetItem = getItems().find((calItem) => Number(calItem.id) === itemId);
  if (!targetItem || !targetItem.date) { closePushDialog(); return; }

  const targetDate = targetItem.date;
  const beforeSnapshot = getItems().map(cloneItem); // for undo

  if (scopeSingle) {
    const newDate = addDaysToISODate(targetDate, days);
    runSql('UPDATE events SET date = ? WHERE id = ?;', [newDate, itemId]);
  } else {
    // Push target item and every item in the same calendar on or after its date
    const calId = Number(targetItem.calendar_id) || 0;
    const toUpdate = getItems().filter((calItem) => {
      if (!calItem.date || calItem.date < targetDate) return false;
      return (Number(calItem.calendar_id) || 0) === calId;
    });
    for (const calItem of toUpdate) {
      const newDate = addDaysToISODate(calItem.date, days);
      runSql('UPDATE events SET date = ? WHERE id = ?;', [newDate, Number(calItem.id)]);
    }
  }

  persistDb();
  loadItems();

// Record a single grouped undo entry for all changed items
  const changes = [];
  for (const snap of beforeSnapshot) {
    const after = getItems().find((calItem) => Number(calItem.id) === Number(snap.id));
    if (after && after.date !== snap.date) changes.push({ before: snap, after: cloneItem(after) });
  }
  if (changes.length) pushUndoEntryAndUpdate({ type: 'push', changes });

  const movedCount = scopeSingle ? 1 : getItems().filter((calItem) => {
    const snap = beforeSnapshot.find((s) => Number(s.id) === Number(calItem.id));
    return snap && snap.date !== calItem.date;
  }).length;
  showStatus(`${movedCount} item${movedCount === 1 ? '' : 's'} pushed forward`);

  _renderAll();
  closePushDialog();
  document.getElementById('event-dialog').close();
}

export function toggleTimeInputVisibility(isAllDay) {
  document.getElementById('event-time-row')?.classList.toggle('hidden', isAllDay);
  if (isAllDay) {
    const itemTime = document.getElementById('event-time');
    if (itemTime) itemTime.value = '';
  }
}

/**
 * Returns true if calItem matches searchTerm.
 * Pass the current activeSearchTerm explicitly to avoid module coupling.
 */
export function itemMatchesSearch(calItem, searchTerm, includeNotes = true) {
  if (!searchTerm) return true;
  const haystack = includeNotes
    ? `${calItem?.title || ''} ${calItem?.notes || ''}`.toLowerCase()
    : (calItem?.title || '').toLowerCase();
  return haystack.includes(searchTerm);
}
