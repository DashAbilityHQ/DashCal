// calendar.js — DashCal
import {
  getItems, getDayMap, getActiveCalendarId, runSql, persistDb,
  loadItems, loadDays, bootstrapDays, toISODate, clamp,
  addDaysToISODate, cloneItem, byItemDateTime, getItemDisplayColour,
  normalizeStoredItemColour, getDefaultItemColour, firstOfMonth,
  pushUndoEntry,
} from './db.js';
import { showStatus } from './statusbar.js';
import {
  getWorkingWeek, getHiddenDays, getShownDays, getShowHiddenDays,
  isDayVisible, getContrastText, saveHiddenDays, saveShownDays,
} from './settings.js';
import { getCurrentColumnWidth, updateUndoRedoButtons } from './toolbar.js';
import {
  getPreDragSidebarOpen, setPreDragSidebarOpen,
  getDroppedIntoLater, setDroppedIntoLater,
  showLaterSidebar, hideLaterSidebar,
  renderHoldingSidebar,
} from './later.js';

// ─────────────────────────────────────────
// Mutable state
// ─────────────────────────────────────────
let activeResize = null;
let canvasRafPending = false;
let lockedCentreDate = null;
let isRerendering = false;

// renderCanvas ctx (set by app.js to avoid circular imports)
let _renderCtx = null;
export function setRenderCanvasCallback(ctx) { _renderCtx = ctx; }

let _rangeCtx = null;
export function setRangeCtx(ctx) { _rangeCtx = ctx; }

// ─────────────────────────────────────────
// State getters / setters
// ─────────────────────────────────────────
export function getActiveResize() { return activeResize; }
export function getLockedCentreDate() { return lockedCentreDate; }
export function setLockedCentreDate(val) { lockedCentreDate = val; }
export function getIsRerendering() { return isRerendering; }
export function setIsRerendering(val) { isRerendering = val; }

export const TINY_CARD_HEIGHTS = (function () {
  const chrome = 44, chip = 32, gap = 6, min = 98, maxVisible = 8;
  const table = [];
  for (let n = 0; n <= maxVisible; n++) {
    if (n <= 1) { table[n] = min; continue; }
    table[n] = chrome + n * chip + (n - 1) * gap;
  }
  return table;
})();

export function getTinyCardHeight(itemCount) {
  const capped = Math.min(itemCount, TINY_CARD_HEIGHTS.length - 1);
  return TINY_CARD_HEIGHTS[capped] || TINY_CARD_HEIGHTS[0];
}

export function buildMonthBandMap(orderedDays) {
  const monthBandMap = new Map();
  let previousMonthKey = null;
  let monthBand = 0;

  orderedDays.forEach((date) => {
    const monthKey = date.slice(0, 7);
    if (monthKey !== previousMonthKey) {
      monthBand += 1;
      previousMonthKey = monthKey;
    }
    if (!monthBandMap.has(monthKey)) {
      monthBandMap.set(monthKey, monthBand % 2 === 0 ? 'month-band-a' : 'month-band-b');
    }
  });

  return monthBandMap;
}

export function monthLabelFromKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const currentYear = new Date().getFullYear();
  const date = new Date(year, month - 1, 1);
  const monthName = date.toLocaleDateString(undefined, { month: 'long' });
  return year !== currentYear ? `${monthName} ${year}` : monthName;
}

export function renderMonthHeader(columnMonthKeys, columnWidth, columnGap, monthBandMap) {
  const monthHeader = document.getElementById('month-header');
  if (!monthHeader || !columnMonthKeys.length) return;

  monthHeader.innerHTML = '';
  const totalWidth = columnMonthKeys.length * (columnWidth + columnGap);
  monthHeader.style.width = `${totalWidth}px`;
  monthHeader.style.display = 'flex';
  monthHeader.style.flexDirection = 'row';
  monthHeader.style.gap = '0';
  monthHeader.style.margin = '0';
  monthHeader.style.padding = '0';

  const groups = [];
  columnMonthKeys.forEach((monthKey, columnIndex) => {
    if (!monthKey) return;
    const last = groups[groups.length - 1];
    if (last && last.monthKey === monthKey) {
      last.count += 1;
    } else {
      groups.push({ monthKey, count: 1, startColumn: columnIndex });
    }
  });

  if (!groups.length) return;

  groups.forEach((group) => {
    const cell = document.createElement('div');
    cell.className = 'month-header-cell';
    cell.textContent = monthLabelFromKey(group.monthKey);
    cell.style.flex = `0 0 ${group.count * columnWidth}px`;
    const bandClass = monthBandMap.get(group.monthKey) || 'month-band-a';
    cell.classList.add(bandClass);
    monthHeader.appendChild(cell);
  });
}

// ─────────────────────────────────────────
// UI state helpers
// ─────────────────────────────────────────
export function getCentreVisibleDate() {
  const wrap = document.querySelector('.main-canvas-wrap');
  const canvas = document.getElementById('main-canvas');
  const centrX = wrap.scrollLeft + wrap.clientWidth / 2;
  const cards = [...canvas.querySelectorAll('.day-card[data-date]')];
  let closest = null;
  let closestDist = Infinity;
  cards.forEach((card) => {
    const col = card.closest('.day-column');
    if (!col) return;
    const cardCentre = col.offsetLeft + col.offsetWidth / 2;
    const dist = Math.abs(cardCentre - centrX);
    if (dist < closestDist) { closestDist = dist; closest = card.dataset.date; }
  });
  return closest;
}

// ─────────────────────────────────────────
// Drag & resize
// ─────────────────────────────────────────
export function attachResizeDrag(handle, date) {
  let startY = 0;
  let startHeightPx = 110;
  let resizingCard = null;

  const onMove = (event) => {
    const deltaY = event.clientY - startY;
    const liveHeightPx = clamp(startHeightPx + deltaY, 110, 1100);
    if (!activeResize || activeResize.date !== date || Math.abs((activeResize.liveHeightPx ?? 0) - liveHeightPx) > 0.5) {
      activeResize = { date, liveHeightPx };
      scheduleCanvasRender();
    }
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (resizingCard) { resizingCard.classList.remove('is-resizing'); resizingCard = null; }
    if (!activeResize || activeResize.date !== date) return;
    let snappedPx = clamp(Math.round(activeResize.liveHeightPx), 110, 1100);
    activeResize = null;
    const current = getDayMap().get(date).height_px;
    if (snappedPx !== current) {
      getDayMap().get(date).height_px = snappedPx;
      runSql('INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, ?) ON CONFLICT(date, calendar_id) DO UPDATE SET height_px=excluded.height_px;', [date, getActiveCalendarId() || 0, snappedPx]);
      pushUndoEntry({ type: 'day_resize', date, before: current, after: snappedPx });
      updateUndoRedoButtons();
      persistDb();
    }
    if (_renderCtx) renderCanvas(_renderCtx);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (document.documentElement.getAttribute('data-density') === 'glance') return;
    event.preventDefault();
    startY = event.clientY;
    startHeightPx = getDayMap().get(date).height_px;
    resizingCard = handle.closest('.day-card');
    if (resizingCard) resizingCard.classList.add('is-resizing');
    activeResize = { date, liveHeightPx: startHeightPx };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });
}

export function scheduleCanvasRender() {
  if (canvasRafPending) return;
  canvasRafPending = true;
  window.requestAnimationFrame(() => {
    canvasRafPending = false;
    const canvas = document.getElementById('main-canvas');
    if (activeResize) {
      const card = canvas.querySelector(`.day-card[data-date="${activeResize.date}"]`);
      if (card) {
        const liveHeight = clamp(activeResize.liveHeightPx, 110, 1100);
        card.style.height = `${liveHeight}px`;
      }
      return;
    }
    const scrollContainer = canvas.closest('.main-canvas-wrap') || canvas;
    const scrollLeft = scrollContainer.scrollLeft;
    if (_renderCtx) renderCanvas(_renderCtx);
    scrollContainer.scrollLeft = scrollLeft;
  });
}

// ─────────────────────────────────────────
// Range
// ─────────────────────────────────────────
export function extendRangeBackward({ rangeStart, rangeEnd, setRangeStart }) {
  const canvas = document.getElementById('main-canvas');
  const scrollContainer = canvas.closest('.main-canvas-wrap') || canvas;
  const previousScrollLeft = scrollContainer.scrollLeft;
  const previousCanvasWidth = canvas.scrollWidth;

  const newRangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth() - 2, 1);
  setRangeStart(newRangeStart);
  bootstrapDays({ rangeStart: newRangeStart, rangeEnd, activeCalendarId: getActiveCalendarId() });
  loadDays({ rangeStart: newRangeStart, rangeEnd });
  loadItems();
  if (_renderCtx) renderCanvas(_renderCtx);

  const newCanvasWidth = canvas.scrollWidth;
  const addedWidth = Math.max(0, newCanvasWidth - previousCanvasWidth);
  scrollContainer.scrollLeft = previousScrollLeft + addedWidth;
  setTimeout(() => document.querySelector('.main-canvas-wrap')?.scrollBy({ left: -520, behavior: 'smooth' }), 50);
}

export function extendRangeForward({ rangeStart, rangeEnd, setRangeEnd }) {
  const newRangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 2 + 1, 0);
  setRangeEnd(newRangeEnd);
  bootstrapDays({ rangeStart, rangeEnd: newRangeEnd, activeCalendarId: getActiveCalendarId() });
  loadDays({ rangeStart, rangeEnd: newRangeEnd });
  loadItems();
  if (_renderCtx) renderCanvas(_renderCtx);
  setTimeout(() => document.querySelector('.main-canvas-wrap')?.scrollBy({ left: 520, behavior: 'smooth' }), 50);
}

// ─────────────────────────────────────────
// Chip resize drag (moved from later.js)
// ctx: { renderCanvas, renderHoldingSidebar }
// ─────────────────────────────────────────
export function attachItemChipResizeDrag(dimple, chip, calItem, ctx) {
  const { renderCanvas, renderHoldingSidebar: doRenderHoldingSidebar } = ctx;
  let startY = 0;
  let startHeight = 0;
  let rafPending = false;
  let pendingHeight = 0;
  let rafId = 0;

  const onMove = (pointerEvent) => {
    const deltaY = pointerEvent.clientY - startY;
    const nextHeight = clamp(startHeight + deltaY, 35, 420);
    pendingHeight = nextHeight;
    if (rafPending) return;
    rafPending = true;
    rafId = window.requestAnimationFrame(() => {
      chip.style.setProperty('height', `${pendingHeight}px`);
      chip.style.setProperty('min-height', 'unset');
      rafPending = false;
      rafId = 0;
    });
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    chip.classList.remove('is-resizing');
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; rafPending = false; }
    const finalHeight = clamp(Math.round(pendingHeight), 35, 420);
    chip.style.setProperty('height', `${finalHeight}px`);
    if (finalHeight !== startHeight) {
      const beforeItem = { ...calItem, display_size: startHeight };
      const afterItem = { ...calItem, display_size: finalHeight };
      runSql('UPDATE events SET display_size = ? WHERE id = ?;', [finalHeight, Number(calItem.id)]);
      persistDb();
      loadItems();
      pushUndoEntry({ type: 'item_edit', before: beforeItem, after: afterItem });
      updateUndoRedoButtons();
    }
    renderCanvas();
    doRenderHoldingSidebar();
  };

  dimple.addEventListener('pointerdown', (pointerEvent) => {
    if (document.documentElement.getAttribute('data-density') === 'glance') return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    startY = pointerEvent.clientY;
    startHeight = chip.offsetHeight;
    pendingHeight = startHeight;
    chip.classList.add('is-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  dimple.addEventListener('click', (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
  });
}

// ─────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────
export function renderAll(ctx) {
  const { renderMiniCalendar, renderItemList, renderItemFilterSwatches, renderHoldingSidebar: doRenderHoldingSidebar } = ctx;
  renderMiniCalendar();
  renderCanvas(ctx);
  renderItemFilterSwatches();
  renderItemList();
  doRenderHoldingSidebar();
}

export function renderCanvas(ctx) {
  const { openItemDialog, pushUndoEntryAndUpdate, flashDayCard, renderAll: doRenderAll,
    renderMiniCalendar, renderItemList, renderItemFilterSwatches, renderHoldingSidebar: doRenderHoldingSidebar } = ctx;
  const canvas = document.getElementById('main-canvas');
  const monthHeaderEl = document.getElementById('month-header');
  setIsRerendering(true);
  const scrollContainer = canvas.closest('.main-canvas-wrap') || canvas;
  const scrollLeft = scrollContainer.scrollLeft;
  canvas.innerHTML = '';
  if (monthHeaderEl) monthHeaderEl.innerHTML = '';
  const monthHeaderHeight = monthHeaderEl ? monthHeaderEl.offsetHeight : 0;
  const viewportHeight = canvas.clientHeight - monthHeaderHeight;
  const styles = getComputedStyle(document.documentElement);
  const dayGap = Number.parseFloat(styles.getPropertyValue('--day-gap')) || 10;
  const columnWidth = Number.parseFloat(styles.getPropertyValue('--column-width')) || 280;
  const columnGap = Number.parseFloat(styles.getPropertyValue('--column-gap')) || 16;

  const orderedDays = Array.from(getDayMap().keys()).sort((a, b) => a.localeCompare(b));
  const monthBandMap = buildMonthBandMap(orderedDays);
  const isGlanceDensity = document.documentElement.getAttribute('data-density') === 'glance';

  let itemCountByDate;
  if (isGlanceDensity) {
    itemCountByDate = new Map();
    for (const calItem of getItems()) {
      if (calItem.date) itemCountByDate.set(calItem.date, (itemCountByDate.get(calItem.date) || 0) + 1);
    }
  }

  const layout = [];
  let currentColumn = 0;
  let yUsed = 0;

  for (const date of orderedDays) {
    const visibility = isDayVisible(date);
    if (visibility === false) continue;

    const storedHeightPx = clamp(getDayMap().get(date).height_px, 110, 1100);
    let cardHeight;
    if (isGlanceDensity) {
      cardHeight = getTinyCardHeight(itemCountByDate.get(date) || 0);
    } else {
      cardHeight = getActiveResize()?.date === date
        ? clamp(getActiveResize().liveHeightPx, 110, 1100)
        : storedHeightPx;
    }

    if (yUsed + dayGap + cardHeight > viewportHeight && yUsed > 0) {
      currentColumn += 1;
      yUsed = 0;
    }

    layout.push({
      date,
      column: currentColumn,
      monthKey: date.slice(0, 7),
      monthBandClass: monthBandMap.get(date.slice(0, 7)) || 'month-band-a',
      cardHeight,
      isHidden: visibility === 'hidden' || visibility === 'today-hidden'
    });

    yUsed += (yUsed === 0 ? 0 : dayGap) + cardHeight;
  }

  const columnCount = Math.max(1, layout.length ? layout[layout.length - 1].column + 1 : 1);
  const columns = [];
  const columnMonthCounts = Array.from({ length: columnCount }, () => new Map());

  for (let i = 0; i < columnCount; i += 1) {
    const col = document.createElement('section');
    col.className = 'day-column';
    columns.push(col);
    canvas.appendChild(col);
  }

  for (const layoutItem of layout) {
    const counts = columnMonthCounts[layoutItem.column];
    counts.set(layoutItem.monthKey, (counts.get(layoutItem.monthKey) || 0) + 1);

    const slot = document.createElement('div');
    slot.className = `day-slot ${layoutItem.monthBandClass}`;
    const card = renderDayCard(layoutItem, ctx);
    slot.appendChild(card);
    columns[layoutItem.column].appendChild(slot);
  }

  const columnOwnerMonthKeys = columnMonthCounts.map((counts) => {
    const entries = [...counts.entries()];
    if (!entries.length) return null;
    entries.sort((a, b) => {
      const byCount = b[1] - a[1];
      if (byCount !== 0) return byCount;
      return a[0].localeCompare(b[0]);
    });
    return entries[0][0];
  });

  const columnOwnerBands = columnOwnerMonthKeys.map((monthKey) => monthBandMap.get(monthKey) || 'month-band-a');

  columns.forEach((column, index) => {
    column.classList.add(columnOwnerBands[index]);
  });

  columns.forEach((column, index) => {
    const lastItemInColumn = [...layout].reverse().find((layoutItem) => layoutItem.column === index);
    const fillerBandClass = lastItemInColumn?.monthBandClass || columnOwnerBands[index];
    const filler = document.createElement('div');
    filler.className = `day-slot column-fill ${fillerBandClass}`;
    filler.style.flex = '1 1 auto';
    column.appendChild(filler);
  });

  const backwardButton = document.createElement('button');
  backwardButton.type = 'button';
  backwardButton.className = 'range-edge-btn range-edge-btn-left';
  backwardButton.textContent = '‹ 2 months';
  if (_rangeCtx) backwardButton.addEventListener('click', () => extendRangeBackward(_rangeCtx));
  canvas.appendChild(backwardButton);

  const forwardButton = document.createElement('button');
  forwardButton.type = 'button';
  forwardButton.className = 'range-edge-btn range-edge-btn-right';
  forwardButton.textContent = '2 months ›';
  if (_rangeCtx) forwardButton.addEventListener('click', () => extendRangeForward(_rangeCtx));
  canvas.appendChild(forwardButton);
  forwardButton.style.left = `${canvas.scrollWidth - 28}px`;

  renderMonthHeader(columnOwnerMonthKeys, columnWidth, columnGap, monthBandMap);
  scrollContainer.scrollLeft = scrollLeft;
  setIsRerendering(false);
}

export function renderDayCard(layoutItem, ctx) {
  const { openItemDialog, pushUndoEntryAndUpdate, flashDayCard, renderAll: doRenderAll,
    renderMiniCalendar } = ctx;
  const dateObj = new Date(`${layoutItem.date}T00:00:00`);
  const isToday = layoutItem.date === toISODate(new Date());
  const card = document.createElement('article');
  card.className = 'day-card';
  card.classList.add(layoutItem.monthBandClass);
  if (isToday) card.classList.add('today');
  if (layoutItem.isHidden && !isToday) card.classList.add('is-hidden-day');
  card.style.height = `${layoutItem.cardHeight}px`;
  card.dataset.date = layoutItem.date;

  const dayItems = getItems().filter((calItem) => calItem.date === layoutItem.date).sort(byItemDateTime);

  const header = document.createElement('div');
  header.className = 'day-card-header';

  const dayLabel = document.createElement('h4');
  const baseLabel = dateObj.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  if (isToday) {
    const baseText = document.createTextNode(`${baseLabel} - `);
    const todaySpan = document.createElement('span');
    todaySpan.className = 'today-suffix';
    todaySpan.textContent = 'Today';
    dayLabel.appendChild(baseText);
    dayLabel.appendChild(todaySpan);
    if (layoutItem.isHidden) {
      dayLabel.appendChild(document.createTextNode(' - '));
      const hiddenSpan = document.createElement('span');
      hiddenSpan.className = 'hidden-suffix';
      hiddenSpan.textContent = 'Hidden';
      dayLabel.appendChild(hiddenSpan);
    }
  } else if (layoutItem.isHidden) {
    const baseText = document.createTextNode(`${baseLabel} - `);
    const hiddenSpan = document.createElement('span');
    hiddenSpan.className = 'hidden-suffix';
    hiddenSpan.textContent = 'Hidden';
    dayLabel.appendChild(baseText);
    dayLabel.appendChild(hiddenSpan);
  } else {
    dayLabel.textContent = baseLabel;
  }

  const headerActions = document.createElement('div');
  headerActions.className = 'day-header-actions';

  const addItemButton = document.createElement('button');
  addItemButton.type = 'button';
  addItemButton.className = 'day-header-btn';
  addItemButton.setAttribute('aria-label', 'Add item');
  addItemButton.textContent = '+';
  addItemButton.addEventListener('click', (e) => {
    e.stopPropagation();
    openItemDialog({ date: layoutItem.date });
  });

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'day-header-btn';
  const updateHideButton = () => {
    const dow = new Date(`${layoutItem.date}T00:00:00`).getDay();
    const inWorkingWeek = getWorkingWeek().includes(dow);
    const individuallyHidden = getHiddenDays().has(layoutItem.date);
    const individuallyShown = getShownDays().has(layoutItem.date);
    const isHidden = individuallyHidden || (!inWorkingWeek && !individuallyShown);

    hideButton.setAttribute('aria-label', isHidden ? 'Unhide this day' : 'Hide this day');
    hideButton.title = isHidden ? 'Unhide this day' : 'Hide this day';
    hideButton.innerHTML = isHidden
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/></svg>';
  };
  updateHideButton();
  hideButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const dow = new Date(`${layoutItem.date}T00:00:00`).getDay();
    const inWorkingWeek = getWorkingWeek().includes(dow);
    const individuallyHidden = getHiddenDays().has(layoutItem.date);
    const individuallyShown = getShownDays().has(layoutItem.date);
    const isHidden = individuallyHidden || (!inWorkingWeek && !individuallyShown);

    if (isHidden) {
      // Unhide — remove from hiddenDays if present, add to shownDays if globally hidden
      getHiddenDays().delete(layoutItem.date);
      if (!inWorkingWeek) {
        getShownDays().add(layoutItem.date);
        saveShownDays();
      }
      saveHiddenDays();
      showStatus('Day restored');
    } else {
      // Hide — remove from shownDays if present, add to hiddenDays
      getShownDays().delete(layoutItem.date);
      saveShownDays();
      getHiddenDays().add(layoutItem.date);
      saveHiddenDays();
      showStatus('Day hidden');
    }

    renderCanvas(ctx);
    renderMiniCalendar();
  });

  headerActions.append(addItemButton, hideButton);
  header.append(dayLabel, headerActions);

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'day-card-events';

  if (dayItems.length) {
    dayItems.forEach((calItem) => {
      const chip = document.createElement('div');
      chip.className = 'day-event-chip';
      const itemColour = getItemDisplayColour(calItem.user_colour);
      chip.style.background = itemColour;
      const contrastColour = getContrastText(itemColour);
      chip.style.color = contrastColour;
      const displaySize = clamp(Math.round(Number(calItem.display_size) || 52), 35, 420);
      chip.dataset.eventId = String(calItem.id);
      const isGlance = document.documentElement.getAttribute('data-density') === 'glance';
      chip.style.height = isGlance ? '26px' : `${displaySize}px`;

      const chipContent = document.createElement('div');
      chipContent.className = 'chip-content';

      const titleLine = document.createElement('div');
      titleLine.className = 'event-chip-line';
      const titleStrong = document.createElement('strong');

      // Display logic for three item states:
      // - All-day:  "All Day – Title"
      // - Timed:    "HH:MM - Title"
      // - Untimed:  "Title"
      if (calItem.is_all_day) {
        titleStrong.textContent = `All Day \u2013 ${calItem.title || ''}`;
      } else if (calItem.time) {
        titleStrong.textContent = `${calItem.time} - ${calItem.title || ''}`;
      } else {
        titleStrong.textContent = calItem.title || '';
      }

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
        const originCard = chip.closest('.day-card');
        if (originCard) originCard.classList.add('drag-origin');
        const holdingSidebar = document.getElementById('holding-sidebar');
        setPreDragSidebarOpen(!holdingSidebar?.classList.contains('hidden'));
        setDroppedIntoLater(false);
        const chipRect = chip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const sidebarWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0;
        const nearRightEdge = chipRect.right > viewportWidth - sidebarWidth;
        if (!getPreDragSidebarOpen()) requestAnimationFrame(() => {
          showLaterSidebar();
          if (nearRightEdge) {
            document.querySelector('.main-canvas-wrap')?.scrollBy({ left: sidebarWidth * 2, behavior: 'smooth' });
          }
        });
      });

      chip.addEventListener('dragend', () => {
        chip.classList.remove('is-dragging');
        document.querySelector('.day-card.drag-origin')?.classList.remove('drag-origin');
        if (!getPreDragSidebarOpen() && !getDroppedIntoLater()) hideLaterSidebar();
        setDroppedIntoLater(false);
      });

      const dimple = document.createElement('div');
      dimple.className = 'event-chip-dimple';
      dimple.style.color = contrastColour;
      dimple.textContent = '\u25be';
      attachItemChipResizeDrag(dimple, chip, calItem, { renderCanvas: () => renderCanvas(ctx), renderHoldingSidebar: () => renderHoldingSidebar({ openItemDialog, renderCanvas: () => renderCanvas(ctx) }) });
      chip.appendChild(dimple);

      const resizeBar = document.createElement('div');
      resizeBar.className = 'event-chip-resize-bar';
      attachItemChipResizeDrag(resizeBar, chip, calItem, { renderCanvas: () => renderCanvas(ctx), renderHoldingSidebar: () => renderHoldingSidebar({ openItemDialog, renderCanvas: () => renderCanvas(ctx) }) });
      chip.appendChild(resizeBar);

      const chipActions = document.createElement('div');
      chipActions.className = 'chip-actions';
      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'chip-duplicate-btn';
      dupBtn.title = 'Duplicate item';
      dupBtn.textContent = '\u29c9';
      dupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existingIds = new Set(getItems().map((i) => Number(i.id)));
        const source = getItems().find((i) => Number(i.id) === Number(calItem.id));
        if (!source) return;
        runSql(
          'INSERT INTO events(date, title, time, is_all_day, notes, user_colour, display_size, calendar_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?);',
          [
            source.date,
            `${source.title || ''} Copy`,
            source.time,
            source.is_all_day,
            source.notes,
            source.user_colour,
            source.display_size,
            source.calendar_id ?? getActiveCalendarId() ?? 0,
          ]
        );
        persistDb();
        loadItems();
        let addedItem = null;
        for (const ci of getItems()) {
          if (!existingIds.has(Number(ci.id))) {
            addedItem = cloneItem(ci);
            break;
          }
        }
        if (!addedItem && getItems().length) {
          const latest = [...getItems()].sort((a, b) => Number(b.id) - Number(a.id))[0];
          addedItem = cloneItem(latest);
        }
        if (addedItem) pushUndoEntryAndUpdate({ type: 'item_add', item: addedItem });
        doRenderAll();
        showStatus('Item duplicated');
      });
      chipActions.appendChild(dupBtn);
      chip.appendChild(chipActions);

      chip.addEventListener('click', () => openItemDialog(calItem));
      itemsWrap.appendChild(chip);
    });
  }

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  attachResizeDrag(handle, layoutItem.date);

  // — Sticky handle: visual-only, no resize logic changes —
  let stickyDragInProgress = false;

  function applyStickyHandle() {
    const cardRect = card.getBoundingClientRect();
    const statusBarH = document.querySelector('.status-bar')?.offsetHeight || 28;
    if (cardRect.bottom > window.innerHeight - statusBarH) {
      handle.classList.add('handle-sticky');
      handle.style.left = `${cardRect.left}px`;
      handle.style.width = `${cardRect.width}px`;
    } else {
      handle.classList.remove('handle-sticky');
      handle.style.left = '';
      handle.style.width = '';
    }
  }

  card.addEventListener('mouseenter', applyStickyHandle);

  card.addEventListener('mouseleave', () => {
    if (!stickyDragInProgress && handle.classList.contains('handle-sticky')) {
      handle.classList.remove('handle-sticky');
      handle.style.left = '';
      handle.style.width = '';
    }
  });

  handle.addEventListener('pointerdown', () => {
    if (handle.classList.contains('handle-sticky')) {
      stickyDragInProgress = true;
      window.addEventListener('pointerup', () => {
        stickyDragInProgress = false;
        applyStickyHandle();
      }, { once: true });
    }
  });

  card.addEventListener('dragover', (dragEvent) => dragEvent.preventDefault());

  card.addEventListener('dragenter', () => card.classList.add('drop-target'));

  card.addEventListener('dragleave', (dragEvent) => {
    const relatedTarget = dragEvent.relatedTarget;
    if (relatedTarget instanceof Node && card.contains(relatedTarget)) return;
    card.classList.remove('drop-target');
  });

  card.addEventListener('drop', (dragEvent) => {
    dragEvent.preventDefault();
    card.classList.remove('drop-target');
    const rawId = dragEvent.dataTransfer?.getData('text/plain');
    const itemId = Number(rawId);
    const destinationDate = card.dataset.date;
    if (!itemId || !destinationDate) return;

    const beforeItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === itemId));
    if (!beforeItem) return;
    if (beforeItem.date === destinationDate) return;

    runSql('UPDATE events SET date = ? WHERE id = ?;', [destinationDate, itemId]);
    persistDb();
    loadItems();
    const afterItem = cloneItem(getItems().find((calItem) => Number(calItem.id) === itemId));
    if (afterItem) {
      pushUndoEntryAndUpdate({ type: 'item_edit', before: beforeItem, after: afterItem });
    }
    doRenderAll(ctx);
    flashDayCard(destinationDate, 'flash-save');
    showStatus('Item moved');
  });

  card.append(header, itemsWrap, handle);
  card.addEventListener('dblclick', () => openItemDialog({ date: layoutItem.date }));

  return card;
}

// ─────────────────────────────────────────
// Sticky handle evaluation
// ─────────────────────────────────────────
export function reevaluateAllStickyHandles() {
  const statusBarH = document.querySelector('.status-bar')?.offsetHeight || 28;
  document.querySelectorAll('.day-card').forEach((card) => {
    const handle = card.querySelector('.drag-handle');
    if (!handle) return;
    const cardRect = card.getBoundingClientRect();
    if (cardRect.bottom > window.innerHeight - statusBarH) {
      handle.classList.add('handle-sticky');
      handle.style.left = `${cardRect.left}px`;
      handle.style.width = `${cardRect.width}px`;
    } else {
      handle.classList.remove('handle-sticky');
      handle.style.left = '';
      handle.style.width = '';
    }
  });
}

