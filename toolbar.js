// toolbar.js — DashCal toolbar module
import { showStatus, recordExport } from './statusbar.js';
import { renderPaletteEditor, renderSwatches } from './settings.js';
import {
  getItems, getDayMap, getUndoStack, setUndoStack, getRedoStack,
  setRedoStack, getActiveCalendarId, runSql, persistDb, loadDays,
  loadItems, bootstrapDays, applyAction, pushUndoEntry, pushRedoEntry,
  clamp, toISODate
} from './db.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const COLUMN_WIDTH_KEY = 'dashcal-column-width';
const MIN_COLUMN_WIDTH = 160;
const MAX_COLUMN_WIDTH = 600;

// ─── Module state ─────────────────────────────────────────────────────────────
let zoomLevel = 1;

export function setZoomLevel(val) { zoomLevel = val; }

// ─── Undo / Redo buttons ──────────────────────────────────────────────────────
export function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('toolbar-undo-btn');
  const redoBtn = document.getElementById('toolbar-redo-btn');
  if (undoBtn) undoBtn.disabled = getUndoStack().length === 0;
  if (redoBtn) redoBtn.disabled = getRedoStack().length === 0;
}

// ─── Density / column width ───────────────────────────────────────────────────
export function updateDensityPresetState() {
  const width = getCurrentColumnWidth();
  document.querySelectorAll('.density-btn').forEach((button) => {
    const presetWidth = Number(button.dataset.width);
    button.classList.toggle('active', width === presetWidth);
  });
}

export function applyColumnWidth(width, opts = {}, ctx = {}) {
  const { persist = false, rerender = false, centerToday = false } = opts;
  const clampedWidth = clamp(Math.round(width), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  document.documentElement.style.setProperty('--column-width', `${clampedWidth}px`);
  if (clampedWidth <= 190) document.documentElement.setAttribute('data-density', 'glance');
  else document.documentElement.removeAttribute('data-density');
  updateDensityPresetState();
  if (persist) localStorage.setItem(COLUMN_WIDTH_KEY, String(clampedWidth));
  if (rerender) {
    ctx.renderCanvas?.();
    if (centerToday) centerTodayColumn();
  }
}

export function restoreColumnWidth() {
  const raw = localStorage.getItem(COLUMN_WIDTH_KEY);
  const saved = Number(raw);
  if (!raw || !Number.isFinite(saved)) {
    applyColumnWidth(300, { persist: false, rerender: false, centerToday: false });
    return;
  }
  const clamped = clamp(Math.round(saved), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  applyColumnWidth(clamped, { persist: false, rerender: false, centerToday: false });
}

export function getCurrentColumnWidth() {
  const width = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--column-width'));
  return Number.isFinite(width) ? width : 280;
}

// ─── Scroll helpers ───────────────────────────────────────────────────────────
export function centerTodayColumn() {
  const todayIso = toISODate(new Date());
  const canvas = document.getElementById('main-canvas');
  const mainCanvasWrap = document.querySelector('.main-canvas-wrap');
  const todayCard = canvas?.querySelector(`.day-card[data-date="${todayIso}"]`);
  if (!todayCard) return;
  const todayColumn = todayCard.closest('.day-column');
  if (!todayColumn || !mainCanvasWrap) return;
  const targetLeft = todayColumn.offsetLeft - ((mainCanvasWrap.clientWidth - todayColumn.offsetWidth) / 2);
  mainCanvasWrap.scrollLeft = Math.max(0, targetLeft);
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────
// TODO: wire applyZoom to toolbar buttons for zoom in/out/reset
export function applyZoom(delta, ctx = {}) {
  zoomLevel = parseFloat(clamp(zoomLevel + delta, 0.5, 2).toFixed(1));
  const shell = document.querySelector('.app-shell');
  shell.style.transformOrigin = 'top left';
  shell.style.transform = `scale(${zoomLevel})`;
  shell.style.width = `${100 / zoomLevel}%`;
  shell.style.height = `${100 / zoomLevel}%`;
  ctx.renderCanvas?.();
}

// ─── Theme buttons ────────────────────────────────────────────────────────────
export function updateThemeButtons() {
  const currentThemePreference = document.documentElement.getAttribute('data-theme') || 'system';
  document.querySelectorAll('.theme-btn').forEach((button) => {
    const mode = button.dataset.themeMode;
    button.classList.toggle('active', mode === currentThemePreference);
  });
}

// ─── Undo / Redo handlers ─────────────────────────────────────────────────────
export function handleUndo({ renderAll }) {
  const action = getUndoStack().pop();
  if (!action) { updateUndoRedoButtons(); return; }
  const result = applyAction(action, 'undo');
  pushRedoEntry(action);
  persistDb();
  loadItems();
  renderAll();
  if (action && action.type === 'palette_edit' || result === 'palette_edit') {
    try { renderPaletteEditor(); renderSwatches(); } catch (e) {}
  }
  updateUndoRedoButtons();
  showStatus('Undo successful');
}

export function handleRedo({ renderAll }) {
  const action = getRedoStack().pop();
  if (!action) { updateUndoRedoButtons(); return; }
  const result = applyAction(action, 'redo');
  pushUndoEntry(action, { clearRedo: false });
  persistDb();
  loadItems();
  renderAll();
  if (action && action.type === 'palette_edit' || result === 'palette_edit') {
    try { renderPaletteEditor(); renderSwatches(); } catch (e) {}
  }
  updateUndoRedoButtons();
  showStatus('Redo successful');
}

// ─── Wipe / Reset handlers ────────────────────────────────────────────────────
export async function handleWipeAll() {
  console.log('wipe fired')
  const confirmed = window.confirm('This will delete everything — all calendars, all items, all day heights — and start fresh with a single Default calendar. Are you sure?');
  if (!confirmed) return;

  runSql('DELETE FROM events;');
  runSql('DELETE FROM days;');
  runSql('DELETE FROM calendars;');
  runSql("INSERT INTO calendars (name) VALUES ('Default');");
  await persistDb();
  document.getElementById('palette-dialog')?.close();
  window.location.reload();
}
