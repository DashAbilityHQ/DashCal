// app.js — DashCal 
import { showStatus, initStatusBar, recordExport, renderExportNudge } from './statusbar.js';
import {
  initItems,
  openItemDialog, saveItemFromForm, openPushDialog, closePushDialog, executePush,
  toggleTimeInputVisibility, itemMatchesSearch,
  pushUndoEntryAndUpdate,
  getActiveItemColour, setActiveItemColour,
  getLastEnteredTime, setLastEnteredTime,
} from './items.js';
import {
  updateUndoRedoButtons, updateDensityPresetState, updateThemeButtons,
  applyColumnWidth, restoreColumnWidth, getCurrentColumnWidth,
  centerTodayColumn, handleUndo, handleRedo, handleWipeAll, applyZoom,
  setZoomLevel
} from './toolbar.js';
import {
  getCurrentThemePreference,
  getWorkingWeek, getHiddenDays,
  getShowHiddenDays, setShowHiddenDays,
  loadThemePreference, applyThemePreference, loadHiddenDaysState,
  saveWorkingWeek, saveHiddenDays, saveShowHidden,
  isDayVisible, updateShowHiddenButton, openPaletteDialog,
  renderPaletteEditor, renderWorkingWeekGrid, updatePaletteHeader,
  snapshotPaletteState, renderSwatches, updateSwatchSelection,
  getContrastText, rgbToHex, renderAdvancedSection, openExportOptions
} from './settings.js';
import { installSeedData, removeSeedData, renderSeedDataRow,
  isSeedInstalled, seedInstalledKey, seedStartKey } from './seed.js';
import {
  getPreDragSidebarOpen, setPreDragSidebarOpen,
  getDroppedIntoLater, setDroppedIntoLater,
  showLaterSidebar, hideLaterSidebar,
  updateLaterCount, renderHoldingSidebar,
  setupHoldingSidebarDropZone
} from './later.js';
import {
  renderMiniCalendar, renderItemList, renderItemFilterSwatches,
  renderCalendarSelector,
  scrollDateIntoView, flashDayCard, jumpToToday,
  getSelectedSidebarColourFilters, setSelectedSidebarColourFilters,
  setActiveSearchTerm,
  getMiniMonthCursor, setMiniMonthCursor,
  getSelectedDate,
  initSidebar,
  syncMiniCalendarToCentredMonthHeader, scheduleMiniCalendarScrollSync
} from './sidebar.js';
import {
  normalizeHex, getDefaultItemColour, normalizeStoredItemColour,
  getItemDisplayColour, byItemDateTime, cloneItem,
  getSQL, setSQL, getDb, setDb, isUsingSqlRuntime, setUsingSqlRuntime,
  getItems, getDayMap, getCalendars,
  getActiveCalendarId, setActiveCalendarId, getUndoStack, setUndoStack,
  getRedoStack, setRedoStack, getUserColours, setUserColours,
  persistDb, runSql, querySql, createSchema, loadCalendars,
  loadUserColours, loadUserColoursFromCalendar, saveUserColoursToDB,
  loadDays, loadItems, bootstrapDays, addCalendar, removeCalendar,
  pushUndoEntry, pushRedoEntry, applyAction,
  loadDbFromStorage, loadLocalDbFromStorage, migrateLocalStorageToDB,
  toISODate, clamp, addDaysToISODate, formatFriendlyDate, firstOfMonth, addMonths
} from './db.js';
import {
  getTinyCardHeight, buildMonthBandMap, monthLabelFromKey,
  renderMonthHeader,
  scheduleCanvasRender, attachResizeDrag,
  getCentreVisibleDate,
  extendRangeBackward, extendRangeForward,
  getActiveResize,
  getLockedCentreDate, setLockedCentreDate,
  getIsRerendering, setIsRerendering,
  setRenderCanvasCallback, setRangeCtx,
  renderAll, renderCanvas, renderDayCard, attachItemChipResizeDrag,
  reevaluateAllStickyHandles
} from './calendar.js';
import {
  setupImportExport, exportSql, exportDb, exportIcs,
  handleSqlFileInput, handleDbFileInput, handleIcsFileInput
} from './import-export.js';


let rangeStart = null;
let rangeEnd = null;
let resizeDebounceTimer = null;
let stickyResizeTimer = null;
// (miniCalendarScrollSyncRaf moved to sidebar.js where it's used)

function setRangeStart(val) { rangeStart = val; }
function setRangeEnd(val) { rangeEnd = val; }

const refs = {
  mainCanvasWrap: document.querySelector('.main-canvas-wrap'),
  densityButtons: [...document.querySelectorAll('.density-btn')],
  toolbarUndoBtn: document.getElementById('toolbar-undo-btn'),
  toolbarRedoBtn: document.getElementById('toolbar-redo-btn'),
  toolbarShowHiddenBtn: document.getElementById('toolbar-show-hidden-btn'),
  toolbarSettingsBtn: document.getElementById('toolbar-settings-btn'),
  icsFileInput: document.getElementById('ics-file-input'),
  sqlFileInput: document.getElementById('sql-file-input'),
  dbFileInput: document.getElementById('db-file-input'),
  monthHeader: document.getElementById('month-header'),
  canvas: document.getElementById('main-canvas'),
  miniCalendar: document.getElementById('mini-calendar'),
  miniLabel: document.getElementById('mini-month-label'),
  sidebarSearch: document.getElementById('sidebar-search'),
  searchIncPast: document.getElementById('search-inc-past'),
  searchIncNotes: document.getElementById('search-inc-notes'),
  itemList: document.getElementById('event-list'),
  newItemBtn: document.getElementById('new-event-btn'),
  miniPrev: document.getElementById('mini-prev'),
  miniNext: document.getElementById('mini-next'),
  dialog: document.getElementById('event-dialog'),
  itemForm: document.getElementById('event-form'),
  itemId: document.getElementById('event-id'),
  itemDate: document.getElementById('event-date'),
  itemAllDay: document.getElementById('event-all-day'),
  itemTimeRow: document.getElementById('event-time-row'),
  itemTime: document.getElementById('event-time'),
  itemTitle: document.getElementById('event-title'),
  itemNotes: document.getElementById('event-notes'),
  swatchRow: document.getElementById('swatch-row'),
  dialogPaletteBtn: document.getElementById('dialog-palette-btn'),
  dialogColourClearBtn: document.getElementById('dialog-colour-clear-btn'),
  itemFilterSwatches: document.getElementById('event-filter-swatches'),
  deleteItemBtn: document.getElementById('delete-event-btn'),
  cancelItemBtn: document.getElementById('cancel-event-btn'),
  dialogActions: document.querySelector('#event-dialog .dialog-actions'),
  dialogTitle: document.getElementById('event-dialog-title'),
  paletteDialog: document.getElementById('palette-dialog'),
  paletteCloseBtn: document.getElementById('palette-close-btn'),
  paletteSlotGrid: document.getElementById('palette-slot-grid'),
  workingWeekGrid: document.getElementById('working-week-grid'),
  themeButtons: [...document.querySelectorAll('.theme-btn')],
  advancedToggleBtn: document.getElementById('advanced-toggle-btn'),
  advancedBody: document.getElementById('advanced-body'),
  seedDataRow: document.getElementById('seed-data-row'),
  importExportRow: document.getElementById('import-export-row'),
  calendarTrigger: document.getElementById('calendar-trigger'),
  calendarDropdown: document.getElementById('calendar-dropdown'),
  calendarAddBtn: document.getElementById('calendar-add-btn'),
  holdingNewItemBtn: document.getElementById('holding-new-event-btn'),
  holdingItemList: document.getElementById('holding-event-list'),
  holdingSidebar: document.getElementById('holding-sidebar'),
  holdingHideBtn: document.getElementById('holding-hide-btn'),
  toolbarLaterBtn: document.getElementById('toolbar-later-btn'),
  pushItemBtn: document.getElementById('push-event-btn'),
  pushDialog: document.getElementById('push-dialog'),
  pushCancelBtn: document.getElementById('push-cancel-btn'),
  pushConfirmBtn: document.getElementById('push-confirm-btn'),
  pushDaysInput: document.getElementById('push-days'),
  pushScopeSingle: document.getElementById('push-scope-single'),
};

init().catch((error) => {
  console.error(error);
  alert('DashCal failed to initialize. See console for details.');
});

// ─────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────
async function init() {
  const today = new Date();
  rangeStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  rangeEnd = new Date(today.getFullYear(), today.getMonth() + 3, 0);

  try {
    if (typeof window.initSqlJs !== 'function') {
      throw new Error('sql.js bootstrap function unavailable');
    }
    setSQL(await window.initSqlJs({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/${file}`
    }));
    setDb(loadDbFromStorage());
    setUsingSqlRuntime(true);
  } catch (error) {
    console.warn('DashCal: sql.js unavailable, using local fallback DB.', error);
    setDb(loadLocalDbFromStorage());
    setUsingSqlRuntime(false);
  }

  createSchema();
  migrateLocalStorageToDB();
  loadCalendars();
  bootstrapDays({ rangeStart, rangeEnd, activeCalendarId: getActiveCalendarId() });
  loadDays({ rangeStart, rangeEnd });
  loadItems();
  loadUserColours();
  loadHiddenDaysState();
  updateShowHiddenButton();
  applyThemePreference(loadThemePreference(), { persist: false });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getCurrentThemePreference() === 'system') {
      applyThemePreference('system', { persist: false });
      renderAll(makeRenderCtx());
    }
  });
  restoreColumnWidth();
  setRenderCanvasCallback(makeRenderCtx());
  setRangeCtx({ rangeStart, rangeEnd, setRangeStart, setRangeEnd });
  initItems({ renderAll: () => renderAll(makeRenderCtx()), flashDayCard, getSelectedDate });
  initSidebar({ 
    renderAll: () => renderAll(makeRenderCtx()), 
    openItemDialog,
    openPaletteDialog: () => openPaletteDialog('dialog', makePaletteCtx())
  });
  setupImportExport({ refs, rangeStart, rangeEnd, makeRenderCtx, makeSidebarCtx });
  window.dashcalAdvancedSettingsContext = makeAdvancedCtx();
  bindEvents();
  hideLaterSidebar();
  renderCalendarSelector(makeSidebarCtx());
  renderAll(makeRenderCtx());
  centerTodayColumn();
  initStatusBar();
}

function bindEvents() {
  refs.newItemBtn.addEventListener('click', () => openItemDialog({ date: getSelectedDate() }));
  refs.holdingNewItemBtn?.addEventListener('click', () => openItemDialog({ _holding: true }));
  refs.holdingHideBtn?.addEventListener('click', () => hideLaterSidebar());
  refs.toolbarLaterBtn?.addEventListener('click', () => showLaterSidebar());
  setupHoldingSidebarDropZone({ renderAll: () => renderAll(makeRenderCtx()), pushUndoEntryAndUpdate, rangeStart, rangeEnd, openItemDialog, renderCanvas: () => renderCanvas(makeRenderCtx()) });

  refs.miniPrev.addEventListener('click', () => {
    setMiniMonthCursor(addMonths(getMiniMonthCursor(), -1));
    renderMiniCalendar();
    const monthIso = toISODate(getMiniMonthCursor());
    const firstDayOfMonth = Array.from(getDayMap().keys())
      .sort()
      .find((d) => d.startsWith(monthIso.slice(0, 7)));
    if (firstDayOfMonth) scrollDateIntoView(firstDayOfMonth);
  });
  refs.miniNext.addEventListener('click', () => {
    setMiniMonthCursor(addMonths(getMiniMonthCursor(), 1));
    renderMiniCalendar();
    const monthIso = toISODate(getMiniMonthCursor());
    const firstDayOfMonth = Array.from(getDayMap().keys())
      .sort()
      .find((d) => d.startsWith(monthIso.slice(0, 7)));
    if (firstDayOfMonth) scrollDateIntoView(firstDayOfMonth);
  });

  refs.itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveItemFromForm();
    refs.dialog.close();
  });

  refs.cancelItemBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('event-dialog')?.close();
  });
  refs.pushItemBtn?.addEventListener('click', openPushDialog);

  refs.deleteItemBtn.addEventListener('click', () => {
    if (!confirm('Delete this item?')) return;
    const id = Number(refs.itemId.value || 0);
    if (!id) return;
    const deletedItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === id));
    runSql('DELETE FROM events WHERE id = ?;', [id]);
    if (deletedItem) {
      pushUndoEntryAndUpdate({ type: 'item_delete', item: deletedItem });
    }
    persistDb();
    loadItems();
    renderAll(makeRenderCtx());
    if (deletedItem?.date) {
      flashDayCard(deletedItem.date, 'flash-delete');
    }
    refs.dialog.close();
    showStatus('Item deleted');
  });

  refs.toolbarUndoBtn?.addEventListener('click', () => handleUndo({ renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }));
  refs.toolbarRedoBtn?.addEventListener('click', () => handleRedo({ renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }));

  refs.toolbarShowHiddenBtn?.addEventListener('click', () => {
    if (!getLockedCentreDate()) {
      setLockedCentreDate(getCentreVisibleDate());
    }
    setShowHiddenDays(!getShowHiddenDays());
    saveShowHidden();
    updateShowHiddenButton();
    renderCanvas(makeRenderCtx());

    const lcd = getLockedCentreDate();
    if (lcd) {
      const cards = [...refs.canvas.querySelectorAll('.day-card[data-date]')];
      const dates = cards.map((c) => c.dataset.date).sort();
      const target = dates.includes(lcd)
        ? lcd
        : dates.reduce((prev, curr) =>
            Math.abs(curr.localeCompare(lcd)) < Math.abs(prev.localeCompare(lcd)) ? curr : prev
          );
      const wrap = refs.canvas.closest('.main-canvas-wrap');
      const card = refs.canvas.querySelector(`.day-card[data-date="${target}"]`);
      if (card && wrap) {
        const col = card.closest('.day-column');
        setIsRerendering(true);
        wrap.scrollLeft = Math.max(0, col.offsetLeft - (wrap.clientWidth / 2) + (col.offsetWidth / 2));
        setIsRerendering(false);
      }
    }
  });

  refs.icsFileInput?.addEventListener('change', handleIcsFileInput);
  refs.sqlFileInput?.addEventListener('change', handleSqlFileInput);
  refs.dbFileInput?.addEventListener('change', handleDbFileInput);

  refs.calendarTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    refs.calendarDropdown?.classList.toggle('open');
    if (!refs.calendarDropdown?.classList.contains('open')) {
      document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!refs.calendarDropdown?.classList.contains('open')) return;
    const sel = e.target.closest('.calendar-selector');
    if (!sel) {
      refs.calendarDropdown.classList.remove('open');
      document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());
    }
  });

  refs.calendarAddBtn?.addEventListener('click', () => {
    const name = prompt('New calendar name:');
    if (!name || !name.trim()) return;
    addCalendar(name.trim());
    const newCal = getCalendars()[getCalendars().length - 1];
    if (newCal) {
      setActiveCalendarId(Number(newCal.id));
      loadUserColoursFromCalendar();
      loadHiddenDaysState();
      updateShowHiddenButton();
      refs.calendarDropdown?.classList.remove('open');
      document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());
    }
    renderSwatches();
    renderPaletteEditor(makePaletteCtx());
    renderCalendarSelector(makeSidebarCtx());
    bootstrapDays({ rangeStart, rangeEnd, activeCalendarId: getActiveCalendarId() });
    loadDays({ rangeStart, rangeEnd });
    loadItems();
    renderAll(makeRenderCtx());
  });

  refs.advancedToggleBtn?.addEventListener('click', () => {
    const body = refs.advancedBody;
    if (!body) return;
    const isCollapsed = body.classList.toggle('collapsed');
    refs.advancedToggleBtn.textContent = isCollapsed ? 'Advanced \u25be' : 'Advanced \u25b4';
    if (!isCollapsed) renderAdvancedSection(makeAdvancedCtx());
  });

  // All Day checkbox: hide/show time row and track the last entered time
  refs.itemAllDay.addEventListener('change', () => {
    if (refs.itemAllDay.checked) {
      setLastEnteredTime(refs.itemTime.value || getLastEnteredTime());
      toggleTimeInputVisibility(true);
    } else {
      toggleTimeInputVisibility(false);
      if (getLastEnteredTime()) {
        refs.itemTime.value = getLastEnteredTime();
      }
    }
  });

  refs.densityButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const width = Number(button.dataset.width);
      if (!Number.isFinite(width)) return;
      applyColumnWidth(width, { persist: true, rerender: true, centerToday: true }, { renderCanvas: () => renderCanvas(makeRenderCtx()) });
    });
  });

  refs.sidebarSearch?.addEventListener('input', () => {
    setActiveSearchTerm((refs.sidebarSearch.value || '').trim().toLowerCase());
    renderItemList();
  });
  refs.searchIncPast?.addEventListener('change', renderItemList);
  refs.searchIncNotes?.addEventListener('change', renderItemList);

  refs.toolbarSettingsBtn.addEventListener('click', () => openPaletteDialog('toolbar', makePaletteCtx()));
  refs.dialogPaletteBtn?.addEventListener('click', () => openPaletteDialog('dialog', makePaletteCtx()));
  refs.dialogColourClearBtn?.addEventListener('click', () => {
    setActiveItemColour(getDefaultItemColour());
    updateSwatchSelection();
    const colourBar = document.getElementById('event-dialog-colour-bar');
    if (colourBar) {
      const colourTitle = document.getElementById('event-dialog-colour-title');
      const displayColour = getItemDisplayColour(getDefaultItemColour());
      const contrastColour = getContrastText(displayColour);
      colourBar.style.background = displayColour;
      colourBar.style.color = contrastColour;
      if (colourTitle) colourTitle.style.color = contrastColour;
    }
  });
  refs.swatchRow?.addEventListener('swatch-select', (e) => {
    setActiveItemColour(e.detail.hex);
  });
  refs.paletteDialog?.addEventListener('close', () => {
    refs.dialog?.classList.remove('is-backgrounded');
    refs.dialogActions?.classList.remove('actions-hidden');
  });

  const wrap = document.querySelector('.main-canvas-wrap');
  wrap.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    refs.canvas.closest('.main-canvas-wrap').scrollLeft += e.deltaY;
  }, { passive: false });

  wrap.addEventListener('scroll', () => {
    refs.monthHeader.style.transform = `translateX(-${wrap.scrollLeft}px)`;
    if (!getIsRerendering()) {
      setLockedCentreDate(null);
    }
    scheduleMiniCalendarScrollSync();
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = window.setTimeout(() => {
      renderCanvas(makeRenderCtx());
    }, 120);
  });

  window.addEventListener('resize', () => {
    clearTimeout(stickyResizeTimer);
    stickyResizeTimer = window.setTimeout(reevaluateAllStickyHandles, 180);
  });

  window.addEventListener('keydown', handleGlobalKeydown);

  refs.themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.themeMode;
      if (!mode) return;
      applyThemePreference(mode, { persist: true });
      renderAll(makeRenderCtx());
      updatePaletteHeader(makePaletteCtx());
      showStatus('Settings saved');
    });
  });

  updateDensityPresetState();
  updateUndoRedoButtons();
  updateThemeButtons();
}

function makePaletteCtx() {
  return {
    renderAll: () => renderAll(makeRenderCtx()),
    renderCanvas: () => renderCanvas(makeRenderCtx()),
    renderMiniCalendar,
    renderItemList,
    renderItemFilterSwatches,
    pushUndoEntryAndUpdate,
    getActiveItemColour,
    setActiveItemColour,
    getSelectedSidebarColourFilters,
    setSelectedSidebarColourFilters,
  };
}

function makeAdvancedCtx() {
  return {
    exportIcs,
    exportSql,
    exportDb,
    handleWipeAll,
    openPaletteDialog,
    renderSeedDataRow: () => {
      if (document.getElementById('seed-data-row')) renderSeedDataRow({
        activeCalendarId: getActiveCalendarId(),
        isSeedInstalled,
        installSeedData: (s) => installSeedData(s, { activeCalendarId: getActiveCalendarId(), workingWeek: getWorkingWeek(), db: getDb(), usingSqlRuntime: isUsingSqlRuntime(), runSql, persistDb, rangeStart, rangeEnd }),
        removeSeedData: () => removeSeedData({ activeCalendarId: getActiveCalendarId(), db: getDb(), usingSqlRuntime: isUsingSqlRuntime(), persistDb, loadDays, loadItems, renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }),
        loadDays,
        loadItems,
        renderAll: () => renderAll(makeRenderCtx()),
        rangeStart,
        rangeEnd,
        toISODate,
        formatFriendlyDate,
      });
    },
  };
}

function makeSidebarCtx() {
  return {
    get rangeStart() { return rangeStart; },
    get rangeEnd() { return rangeEnd; },
    renderAll: () => renderAll(makeRenderCtx()),
    loadDays,
    loadItems,
    renderSwatches,
    renderPaletteEditor: () => renderPaletteEditor(makePaletteCtx()),
    renderSeedDataRow: () => {
      if (document.getElementById('seed-data-row')) renderSeedDataRow({
        activeCalendarId: getActiveCalendarId(),
        isSeedInstalled,
        installSeedData: (s) => installSeedData(s, { activeCalendarId: getActiveCalendarId(), workingWeek: getWorkingWeek(), db: getDb(), usingSqlRuntime: isUsingSqlRuntime(), runSql, persistDb, rangeStart, rangeEnd }),
        removeSeedData: () => removeSeedData({ activeCalendarId: getActiveCalendarId(), db: getDb(), usingSqlRuntime: isUsingSqlRuntime(), persistDb, loadDays, loadItems, renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }),
        loadDays,
        loadItems,
        renderAll: () => renderAll(makeRenderCtx()),
        rangeStart,
        rangeEnd,
        toISODate,
        formatFriendlyDate,
      });
    },
  };
}

// ─────────────────────────────────────────
// Rendering helpers
// ─────────────────────────────────────────
function makeRenderCtx() {
  const ctx = {
    openItemDialog,
    pushUndoEntryAndUpdate,
    flashDayCard,
    renderMiniCalendar,
    renderItemList,
    renderItemFilterSwatches,
    renderHoldingSidebar: () => renderHoldingSidebar({ openItemDialog, renderCanvas: () => renderCanvas(ctx) }),
  };
  ctx.renderAll = () => renderAll(ctx);
  return ctx;
}

// ─────────────────────────────────────────
// User interactions  (openItemDialog, saveItemFromForm, openPushDialog,
//                     closePushDialog, executePush, toggleTimeInputVisibility
//                     — all live in items.js)
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// Data & persistence
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// Rendering & UI coordination
// ─────────────────────────────────────────
// Note: Import/export functions moved to import-export.js
// Note: renderAdvancedSection and renderImportExportRow moved to settings.js
// Note: parseMonthCursorFromHeaderLabel, syncMiniCalendarToCentredMonthHeader,
//       scheduleMiniCalendarScrollSync moved to sidebar.js
// Note: reevaluateAllStickyHandles moved to calendar.js

// ─────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────
function handleGlobalKeydown(event) {
  const isZoom = (event.ctrlKey || event.metaKey) &&
    (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '0');

  if (isZoom) {
    event.preventDefault();
    if (event.key === '-') applyZoom(-0.1, { renderCanvas: () => renderCanvas(makeRenderCtx()) });
    else if (event.key === '+' || event.key === '=') applyZoom(0.1, { renderCanvas: () => renderCanvas(makeRenderCtx()) });
    else if (event.key === '0') {
      setZoomLevel(1);
      const shell = document.querySelector('.app-shell');
      shell.style.transform = '';
      shell.style.width = '';
      shell.style.height = '';
      renderCanvas(makeRenderCtx());
    }
    return;
  }

  if (refs.dialog?.open || refs.paletteDialog?.open) return;
  if (shouldIgnoreShortcutTarget(event.target)) return;

  const key = event.key;
  const keyLower = key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;

  if (modifier) {
    if (keyLower === 'z' && event.shiftKey) { event.preventDefault(); handleRedo({ renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }); return; }
    if (keyLower === 'z') { event.preventDefault(); handleUndo({ renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }); return; }
    if (keyLower === 'y') { event.preventDefault(); handleRedo({ renderAll: () => renderAll(makeRenderCtx()), rangeStart, rangeEnd }); return; }
    if (keyLower === 'f') {
      event.preventDefault();
      refs.sidebarSearch?.focus();
      refs.sidebarSearch?.select();
      return;
    }
  }

  if (keyLower === 't') { event.preventDefault(); jumpToToday(); return; }

  if (key === 'ArrowLeft') {
    event.preventDefault();
    const columnWidth = getCurrentColumnWidth();
    refs.mainCanvasWrap.scrollTo({ left: refs.mainCanvasWrap.scrollLeft - columnWidth, behavior: 'smooth' });
    return;
  }

  if (key === 'ArrowRight') {
    event.preventDefault();
    const columnWidth = getCurrentColumnWidth();
    refs.mainCanvasWrap.scrollTo({ left: refs.mainCanvasWrap.scrollLeft + columnWidth, behavior: 'smooth' });
  }
}

function shouldIgnoreShortcutTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (target.isContentEditable) return true;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

