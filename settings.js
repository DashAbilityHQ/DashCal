// settings.js — DashCal settings, theme, visibility, palette
import { showStatus } from './statusbar.js';
import {
  getUserColours, setUserColours, getActiveCalendarId,
  saveUserColoursToDB, getItems, runSql, querySql, persistDb, loadItems,
  normalizeHex, getDefaultItemColour, normalizeStoredItemColour, getItemDisplayColour,
  DEFAULT_COLOURS, toISODate
} from './db.js';
import { updateThemeButtons, getCurrentColumnWidth } from './toolbar.js';

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────
export const THEME_STORAGE_KEY = 'dashcal-theme';
export const SHOW_HIDDEN_KEY = 'dashcal-show-hidden';

// ─────────────────────────────────────────
// Mutable state
// ─────────────────────────────────────────
let currentThemePreference = 'system';
let workingWeek = [0, 1, 2, 3, 4, 5, 6];
let hiddenDays = new Set();
let shownDays = new Set();
let showHiddenDays = false;
let visibilityLoadedCalendarId = null;
let paletteEditingIndex = null;
let pendingPaletteApply = null;
let paletteAutoOpenPicker = false;
let paletteAutoFocusName = false;
let paletteOpenSnapshot = null;

// ─────────────────────────────────────────
// Getters / setters
// ─────────────────────────────────────────
export function getCurrentThemePreference() { return currentThemePreference; }
export function getWorkingWeek() { return workingWeek; }
export function getHiddenDays() { return hiddenDays; }
export function getShownDays() { return shownDays; }
export function getShowHiddenDays() { return showHiddenDays; }
export function setShowHiddenDays(val) { showHiddenDays = val; }

// ─────────────────────────────────────────
// Theme
// ─────────────────────────────────────────
export function loadThemePreference() {
  const raw = (localStorage.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return 'system';
}

export function applyThemePreference(mode, { persist = false } = {}) {
  const normalized = ['dark', 'light', 'system'].includes(mode) ? mode : 'system';
  currentThemePreference = normalized;
  if (normalized === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', normalized);
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, normalized);
  updateThemeButtons();
}

// ─────────────────────────────────────────
// Hidden days / working week persistence
// ─────────────────────────────────────────
function persistDayVisibilityState() {
  const activeCalendarId = Number(getActiveCalendarId()) || 0;
  runSql('DELETE FROM day_visibility WHERE calendar_id = ?;', [activeCalendarId]);

  const hiddenDow = [0, 1, 2, 3, 4, 5, 6].filter((day) => !workingWeek.includes(day));
  hiddenDow.forEach((dow) => {
    runSql('INSERT INTO day_visibility(calendar_id, day_of_week, visibility) VALUES(?, ?, ?);', [activeCalendarId, dow, 'hidden']);
  });

  [...hiddenDays].forEach((date) => {
    runSql('INSERT INTO day_visibility(calendar_id, date, visibility) VALUES(?, ?, ?);', [activeCalendarId, date, 'hidden']);
  });

  [...shownDays].forEach((date) => {
    runSql('INSERT INTO day_visibility(calendar_id, date, visibility) VALUES(?, ?, ?);', [activeCalendarId, date, 'shown']);
  });

  persistDb();
  visibilityLoadedCalendarId = activeCalendarId;
}

export function loadHiddenDaysState() {
  const activeCalendarId = Number(getActiveCalendarId()) || 0;
  workingWeek = [0, 1, 2, 3, 4, 5, 6];
  hiddenDays = new Set();
  shownDays = new Set();

  let hasWorkingWeekOverrides = false;
  const rows = querySql(
    'SELECT id, calendar_id, date, day_of_week, visibility FROM day_visibility WHERE calendar_id = ?;',
    [activeCalendarId]
  );

  rows.forEach((row) => {
    const visibility = String(row.visibility || '').toLowerCase();
    if (row.date) {
      if (visibility === 'hidden') hiddenDays.add(row.date);
      else if (visibility === 'shown') shownDays.add(row.date);
      return;
    }

    if (row.day_of_week != null) {
      const dow = Number(row.day_of_week);
      if (Number.isInteger(dow) && dow >= 0 && dow <= 6) {
        hasWorkingWeekOverrides = true;
        if (visibility === 'hidden') {
          workingWeek = workingWeek.filter((day) => day !== dow);
        } else if (visibility === 'shown' && !workingWeek.includes(dow)) {
          workingWeek.push(dow);
        }
      }
    }
  });

  if (hasWorkingWeekOverrides) workingWeek.sort((a, b) => a - b);
  visibilityLoadedCalendarId = activeCalendarId;
  showHiddenDays = localStorage.getItem(SHOW_HIDDEN_KEY) === 'true';
}

export function saveWorkingWeek() { persistDayVisibilityState(); }
export function saveHiddenDays() { persistDayVisibilityState(); }
export function saveShownDays() { persistDayVisibilityState(); }
export function saveShowHidden() { localStorage.setItem(SHOW_HIDDEN_KEY, String(showHiddenDays)); }

// ─────────────────────────────────────────
// Visibility
// ─────────────────────────────────────────
export function isDayVisible(isoDate) {
  const currentCalendarId = Number(getActiveCalendarId()) || 0;
  if (visibilityLoadedCalendarId !== currentCalendarId) {
    loadHiddenDaysState();
  }

  const dow = new Date(`${isoDate}T00:00:00`).getDay();
  const inWorkingWeek = workingWeek.includes(dow);
  const individuallyHidden = hiddenDays.has(isoDate);
  const individuallyShown = shownDays.has(isoDate);
  const isHiddenByRule = (!inWorkingWeek || individuallyHidden) && !individuallyShown;

  if (isoDate === toISODate(new Date())) {
    return isHiddenByRule ? 'today-hidden' : true;
  }
  if (isHiddenByRule) return showHiddenDays ? 'hidden' : false;
  return true;
}

export function updateShowHiddenButton() {
  document.getElementById('toolbar-show-hidden-btn')?.classList.toggle('active', showHiddenDays);
}

// ─────────────────────────────────────────
// Colour utilities
// ─────────────────────────────────────────
export function getContrastText(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1c1c1c' : '#f0f0f0';
}

export function rgbToHex(rgb) {
  if (!rgb) return null;
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return null;
  const [r, g, b] = match.map(Number);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// ─────────────────────────────────────────
// Palette snapshot
// ─────────────────────────────────────────
export function snapshotPaletteState() {
  paletteOpenSnapshot = {
    colours: getUserColours().map(c => ({ ...c })),
    workingWeek: [...workingWeek],
    theme: currentThemePreference
  };
}

export function paletteStateMatchesSnapshot() {
  if (!paletteOpenSnapshot) return true;
  if (getUserColours().length !== paletteOpenSnapshot.colours.length) return false;
  const coloursMatch = getUserColours().every((c, i) =>
    c.hex === paletteOpenSnapshot.colours[i].hex && c.name === paletteOpenSnapshot.colours[i].name
  );
  const weekMatches = workingWeek.length === paletteOpenSnapshot.workingWeek.length &&
    workingWeek.every((d, i) => d === paletteOpenSnapshot.workingWeek[i]);
  const themeMatches = currentThemePreference === paletteOpenSnapshot.theme;
  return coloursMatch && weekMatches && themeMatches;
}

export function restorePaletteSnapshot(ctx = {}) {
  if (!paletteOpenSnapshot) return;
  setUserColours(paletteOpenSnapshot.colours.map(c => ({ ...c })));
  saveUserColoursToDB();
  workingWeek = [...paletteOpenSnapshot.workingWeek];
  saveWorkingWeek();
  applyThemePreference(paletteOpenSnapshot.theme, { persist: true });
  renderSwatches();
  renderPaletteEditor(ctx);
  if (ctx.renderItemFilterSwatches) ctx.renderItemFilterSwatches();
  if (ctx.renderItemList) ctx.renderItemList();
}

// ─────────────────────────────────────────
// Swatch rendering (item dialog)
// ─────────────────────────────────────────

// activeItemColour lives in app.js; these functions receive it via parameter or
// read it from the shared swatchRow DOM. updateSwatchSelection reads from the
// rendered DOM so it only needs the current active colour.

export function renderSwatches() {
  const swatchRow = document.getElementById('swatch-row');
  if (!swatchRow) return;
  // activeItemColour is read via a shared module-level ref exposed by app.js.
  // To avoid a circular dependency we read the currently-selected swatch from
  // the DOM itself: the swatch whose background matches the selected colour
  // will have the 'selected' class already; here we simply rebuild the list and
  // re-apply selection via updateSwatchSelection after each click.
  //
  // For the initial render (called from openItemDialog) the caller must set
  // swatchRow's data-active attribute before calling renderSwatches, OR we
  // export renderSwatches to accept the active colour.
  //
  // Design decision: accept activeItemColour as a parameter so we have no
  // dependency on app.js state.  Existing call sites pass it via
  // renderSwatches(activeItemColour, onSelect).
  //
  // However, the user specification says "Do not change any logic / Do not
  // rename any functions" and renderSwatches() is called without arguments in
  // the original code.  We therefore read activeItemColour from a data
  // attribute on swatchRow that app.js keeps in sync.
  const activeColour = (swatchRow.dataset.activeColour || getDefaultItemColour()).toUpperCase();
  swatchRow.innerHTML = '';
  getUserColours().forEach((slot) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.style.background = slot.hex;
    swatch.title = slot.name;
    if (slot.hex.toUpperCase() === activeColour) swatch.classList.add('selected');

    const label = document.createElement('span');
    label.className = 'swatch-label';
    label.textContent = slot.name;
    label.style.color = getContrastText(slot.hex);
    swatch.appendChild(label);

    swatch.addEventListener('click', () => {
      swatchRow.dataset.activeColour = slot.hex.toUpperCase();
      updateSwatchSelection();

      const colourBar = document.getElementById('event-dialog-colour-bar');
      if (colourBar) {
        const colourTitle = document.getElementById('event-dialog-colour-title');
        const displayColour = getItemDisplayColour(slot.hex);
        const contrastColour = getContrastText(displayColour);
        colourBar.style.background = displayColour;
        colourBar.style.color = contrastColour;
        if (colourTitle) colourTitle.style.color = contrastColour;
      }

      // Dispatch a custom event so app.js can sync activeItemColour
      swatchRow.dispatchEvent(new CustomEvent('swatch-select', {
        detail: { hex: slot.hex.toUpperCase() },
        bubbles: true
      }));
    });

    swatchRow.appendChild(swatch);
  });
}

export function updateSwatchSelection() {
  const swatchRow = document.getElementById('swatch-row');
  if (!swatchRow) return;
  const activeColour = (swatchRow.dataset.activeColour || getDefaultItemColour()).toUpperCase();
  [...swatchRow.children].forEach((node) => {
    node.classList.remove('selected');
    const color = rgbToHex(node.style.background);
    if (color && color.toUpperCase() === activeColour) {
      node.classList.add('selected');
    }
  });
}

// ─────────────────────────────────────────
// Palette header
// ─────────────────────────────────────────
export function updatePaletteHeader(ctx = {}) {
  const paletteDialog = document.getElementById('palette-dialog');
  const paletteCloseBtn = document.getElementById('palette-close-btn');
  if (!paletteDialog?.open || !paletteCloseBtn) return;
  const actionsContainer = paletteCloseBtn.parentElement;
  if (!actionsContainer) return;

  const existingCancel = actionsContainer.querySelector('#palette-cancel-btn');
  const isEditing = paletteEditingIndex !== null;
  const hasChanges = !paletteStateMatchesSnapshot();

  if (!hasChanges && !isEditing) {
    if (existingCancel) existingCancel.remove();
    paletteCloseBtn.textContent = 'Close';
    paletteCloseBtn.onclick = () => paletteDialog?.close();
    return;
  }

  if (!existingCancel) {
    const cancelButton = document.createElement('button');
    cancelButton.id = 'palette-cancel-btn';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      pendingPaletteApply = null;
      paletteEditingIndex = null;
      restorePaletteSnapshot(ctx);
      if (ctx.renderAll) ctx.renderAll();
      paletteDialog?.close();
    });
    actionsContainer.insertBefore(cancelButton, paletteCloseBtn);
  }

  paletteCloseBtn.textContent = 'Save & Close';
  paletteCloseBtn.onclick = () => {
    if (pendingPaletteApply) pendingPaletteApply();
    paletteDialog?.close();
  };
}

// ─────────────────────────────────────────
// Palette dialog
// ─────────────────────────────────────────
export function openPaletteDialog(source = 'toolbar', ctx = {}) {
  paletteEditingIndex = null;
  snapshotPaletteState();
  renderPaletteEditor(ctx);
  const dialog = document.getElementById('event-dialog');
  const dialogActions = document.querySelector('#event-dialog .dialog-actions');
  if (source === 'dialog') {
    dialog?.classList.add('is-backgrounded');
    dialogActions?.classList.add('actions-hidden');
  } else {
    dialog?.classList.remove('is-backgrounded');
    dialogActions?.classList.remove('actions-hidden');
  }
  document.getElementById('palette-dialog')?.showModal();
  updatePaletteHeader(ctx);
}

// ─────────────────────────────────────────
// Palette editor
// ─────────────────────────────────────────
export function renderPaletteEditor(ctx = {}) {
  const paletteSlotGrid = document.getElementById('palette-slot-grid');
  if (!paletteSlotGrid) return;
  paletteSlotGrid.innerHTML = '';

  getUserColours().forEach((slot, index) => {
    const slotCard = document.createElement('div');
    slotCard.className = 'palette-slot';

    if (paletteEditingIndex === index) {
      slotCard.classList.add('editing');

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = (normalizeHex(slot.hex) || '#EAC96A').toLowerCase();
      colorInput.className = 'palette-slot-color-input';

      if (paletteAutoOpenPicker) {
        paletteAutoOpenPicker = false;
        requestAnimationFrame(() => setTimeout(() => colorInput.click(), 0));
      }

      const swatch = document.createElement('div');
      swatch.className = 'palette-slot-swatch';
      swatch.style.background = slot.hex;
      swatch.style.cursor = 'pointer';
      swatch.addEventListener('click', () => colorInput.click());
      colorInput.addEventListener('input', () => {
        swatch.style.background = colorInput.value;
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = slot.name;
      nameInput.maxLength = 24;
      nameInput.className = 'palette-slot-name-input';

      if (paletteAutoFocusName) {
        paletteAutoFocusName = false;
        requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
      }

      const applyEdit = () => {
        if (applyEdit._applied) return;
        applyEdit._applied = true;
        pendingPaletteApply = null;
        const nextName = nameInput.value.trim() || slot.name;
        const nextHex = normalizeHex(colorInput.value) || slot.hex;
        const previousColour = { name: getUserColours()[index].name, hex: getUserColours()[index].hex };
        const previousHex = getUserColours()[index].hex;
        getUserColours()[index] = { name: nextName, hex: nextHex };
        saveUserColoursToDB();

        if (ctx.pushUndoEntryAndUpdate) {
          ctx.pushUndoEntryAndUpdate({
            type: 'palette_edit',
            index,
            before: previousColour,
            after: { name: nextName, hex: nextHex }
          });
        }

        const affectedItems = getItems().filter(
          (e) => (normalizeHex(e.user_colour) || '').toUpperCase() === previousHex.toUpperCase()
        );
        affectedItems.forEach((e) => {
          runSql('UPDATE events SET user_colour = ? WHERE id = ?;', [nextHex, Number(e.id)]);
        });
        if (affectedItems.length) {
          persistDb();
          loadItems();
          if (ctx.renderCanvas) ctx.renderCanvas();
        }

        if (ctx.getActiveItemColour && ctx.setActiveItemColour) {
          if ((ctx.getActiveItemColour() || '').toUpperCase() === previousHex.toUpperCase()) {
            ctx.setActiveItemColour(nextHex.toUpperCase());
          }
        }

        if (ctx.getSelectedSidebarColourFilters && ctx.setSelectedSidebarColourFilters) {
          ctx.setSelectedSidebarColourFilters(new Set(
            [...ctx.getSelectedSidebarColourFilters()].map((hex) => {
              if (hex.toUpperCase() === previousHex.toUpperCase()) return nextHex.toUpperCase();
              return hex;
            })
          ));
        }

        paletteEditingIndex = null;
        renderPaletteEditor(ctx);
        renderSwatches();
        if (ctx.renderItemFilterSwatches) ctx.renderItemFilterSwatches();
        if (ctx.renderItemList) ctx.renderItemList();
        updatePaletteHeader(ctx);
        showStatus('Settings saved');
      };

      pendingPaletteApply = applyEdit;

      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyEdit(); }
      });
      nameInput.addEventListener('blur', () => {
        setTimeout(applyEdit, 100);
      });

      slotCard.append(swatch, nameInput, colorInput);
    } else {
      const swatchWrap = document.createElement('div');
      swatchWrap.className = 'palette-slot-swatch-wrap';

      const swatch = document.createElement('div');
      swatch.className = 'palette-slot-swatch';
      swatch.style.background = slot.hex;

      const name = document.createElement('div');
      name.className = 'palette-slot-name';
      name.textContent = slot.name;

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'palette-slot-edit';
      editButton.setAttribute('aria-label', 'Edit colour');
      editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>';
      editButton.addEventListener('click', (e) => {
        e.stopPropagation();
        paletteEditingIndex = index;
        paletteAutoOpenPicker = true;
        renderPaletteEditor(ctx);
        updatePaletteHeader(ctx);
      });

      const hexOverlay = document.createElement('div');
      hexOverlay.className = 'palette-slot-hex-overlay';
      hexOverlay.textContent = (normalizeHex(slot.hex) || slot.hex).toLowerCase();
      hexOverlay.style.color = getContrastText(slot.hex);

      swatchWrap.append(swatch, editButton, hexOverlay);

      swatchWrap.addEventListener('click', () => {
        paletteEditingIndex = index;
        paletteAutoOpenPicker = true;
        paletteAutoFocusName = false;
        renderPaletteEditor(ctx);
        updatePaletteHeader(ctx);
      });

      name.addEventListener('click', (e) => {
        e.stopPropagation();
        paletteEditingIndex = index;
        paletteAutoOpenPicker = false;
        paletteAutoFocusName = true;
        renderPaletteEditor(ctx);
        updatePaletteHeader(ctx);
      });

      slotCard.append(swatchWrap, name);
    }

    paletteSlotGrid.appendChild(slotCard);
  });

  updateThemeButtons();
  renderWorkingWeekGrid(ctx);
  updatePaletteHeader(ctx);
}

// ─────────────────────────────────────────
// Working week grid
// ─────────────────────────────────────────
export function renderWorkingWeekGrid(ctx = {}) {
  const workingWeekGrid = document.getElementById('working-week-grid');
  if (!workingWeekGrid) return;

  workingWeekGrid.innerHTML = '';
  const workingWeekOptions = [
    { dow: 1, label: 'Mo' },
    { dow: 2, label: 'Tu' },
    { dow: 3, label: 'We' },
    { dow: 4, label: 'Th' },
    { dow: 5, label: 'Fr' },
    { dow: 6, label: 'Sa' },
    { dow: 0, label: 'Su' }
  ];

  workingWeekOptions.forEach(({ dow, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'working-week-btn';
    btn.textContent = label;
    btn.classList.toggle('active', workingWeek.includes(dow));
    btn.addEventListener('click', () => {
      if (workingWeek.includes(dow)) {
        if (workingWeek.length > 1) {
          workingWeek = workingWeek.filter((d) => d !== dow);
        }
      } else {
        workingWeek = [...workingWeek, dow].sort((a, b) => a - b);
      }
      saveWorkingWeek();
      renderWorkingWeekGrid(ctx);
      if (ctx.renderCanvas) ctx.renderCanvas();
      if (ctx.renderMiniCalendar) ctx.renderMiniCalendar();
      updatePaletteHeader(ctx);
      showStatus('Settings saved');
    });
    workingWeekGrid.appendChild(btn);
  });
}

// ─────────────────────────────────────────
// Advanced section (seed data + import/export)
// ─────────────────────────────────────────
export function renderAdvancedSection(ctx = {}) {
  // Render seed data row if the context provides it
  if (ctx.renderSeedDataRow) ctx.renderSeedDataRow();
  // Render import/export row with the provided context
  renderImportExportRow(ctx);
}

export function renderImportExportRow(ctx = {}) {
  const row = document.getElementById('import-export-row');
  if (!row) return;
  row.innerHTML = '';

  const mkBtn = (text, handler) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbar-action-btn';
    b.textContent = text;
    if (handler && typeof handler === 'function') {
      b.addEventListener('click', handler);
    }
    return b;
  };

  const grid = document.createElement('div');
  grid.className = 'ie-grid';

  const exportLabel = document.createElement('div');
  exportLabel.className = 'ie-grid-label';
  exportLabel.textContent = 'Export';

  const importLabel = document.createElement('div');
  importLabel.className = 'ie-grid-label';
  importLabel.textContent = 'Import';

  // Get export functions from context
  const exportIcs = ctx.exportIcs;
  const exportSql = ctx.exportSql;
  const exportDb = ctx.exportDb;
  
  // Create export buttons
  const exportIcsBtn = mkBtn('.ics', exportIcs);
  const exportSqlBtn = mkBtn('.sql', exportSql);
  const exportDbBtn = mkBtn('.db', exportDb);
  
  // Create import buttons that click the file inputs
  const importIcsBtn = mkBtn('.ics', () => {
    const input = document.getElementById('ics-file-input');
    if (input) input.click();
  });
  const importSqlBtn = mkBtn('.sql', () => {
    const input = document.getElementById('sql-file-input');
    if (input) input.click();
  });
  const importDbBtn = mkBtn('.db', () => {
    const input = document.getElementById('db-file-input');
    if (input) input.click();
  });

  // Create wipe button
  const wipeBtn = mkBtn('Wipe DB', ctx.handleWipeAll);
  wipeBtn.style.borderColor = 'var(--overdue)';
  wipeBtn.style.color = 'var(--overdue)';

  const wipeRow = document.createElement('div');
  wipeRow.className = 'ie-wipe-row';
  wipeRow.appendChild(wipeBtn);

  grid.append(
    exportLabel, importLabel,
    exportIcsBtn, exportSqlBtn, exportDbBtn,
    importIcsBtn, importSqlBtn, importDbBtn,
    wipeRow
  );

  row.appendChild(grid);
}

export function openExportOptions(ctx = (typeof window !== 'undefined' ? window.dashcalAdvancedSettingsContext : {}) || {}) {
  // Open the settings dialog and expand the advanced section
  // which contains the export buttons
  const { openPaletteDialog } = ctx;
  if (openPaletteDialog) openPaletteDialog('toolbar', {});
  
  const body = document.getElementById('advanced-body');
  if (body && body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    const advancedToggleBtn = document.getElementById('advanced-toggle-btn');
    if (advancedToggleBtn) {
      advancedToggleBtn.textContent = 'Advanced ▴';
    }
    renderAdvancedSection(ctx);
  }
}
