// sidebar.js — DashCal sidebar rendering
import { showStatus } from './statusbar.js';
import { itemMatchesSearch } from './items.js';
import {
  getItems, getDayMap, getActiveCalendarId, setActiveCalendarId,
  getCalendars, getUserColours, removeCalendar, loadCalendars,
  loadDays, loadItems, bootstrapDays, normalizeHex,
  normalizeStoredItemColour, getDefaultItemColour, toISODate,
  firstOfMonth, clamp, byItemDateTime,
  getItemDisplayColour, loadUserColoursFromCalendar,
} from './db.js';
import { seedInstalledKey, seedStartKey, renderSeedDataRow } from './seed.js';
import {
  getWorkingWeek, getHiddenDays, getShownDays, renderSwatches, renderPaletteEditor, getContrastText,
  loadHiddenDaysState, updateShowHiddenButton,
} from './settings.js';

// ─────────────────────────────────────────
// Module state
// ─────────────────────────────────────────
let selectedSidebarColourFilters = new Set();
let activeSearchTerm = '';
let _selectedDate = toISODate(new Date());
let _miniMonthCursor = firstOfMonth(new Date(_selectedDate));
const DAY_CARD_FLASH_DURATION_MS = 1500;
const DAY_CARD_FLASH_DELAY_MS = 600;
let miniCalendarScrollSyncRaf = 0;

const localeMonthNames = Array.from({ length: 12 }, (_, monthIndex) => (
  new Date(2000, monthIndex, 1).toLocaleDateString(undefined, { month: 'long' }).toLowerCase()
));

// Injected app-level callbacks (set via initSidebar)
let _renderAll = () => {};
let _openItemDialog = () => {};

// ─────────────────────────────────────────
// Initialisation (call once from app.js)
// ─────────────────────────────────────────
let _openPaletteDialog = null;

export function initSidebar({ renderAll, openItemDialog, openPaletteDialog }) {
  _renderAll = renderAll;
  _openItemDialog = openItemDialog;
  _openPaletteDialog = openPaletteDialog;
  
  document.getElementById('edit-palette-btn')?.addEventListener('click', () => {
    if (_openPaletteDialog) _openPaletteDialog();
  });
}

// ─────────────────────────────────────────
// State getters / setters
// ─────────────────────────────────────────
export function getSelectedSidebarColourFilters() {
  return selectedSidebarColourFilters;
}
export function setSelectedSidebarColourFilters(val) {
  selectedSidebarColourFilters = val;
}
export function getActiveSearchTerm() { return activeSearchTerm; }
export function setActiveSearchTerm(val) { activeSearchTerm = val; }

export function getMiniMonthCursor() { return _miniMonthCursor; }
export function setMiniMonthCursor(val) { _miniMonthCursor = val; }
export function getSelectedDate() { return _selectedDate; }
export function setSelectedDate(val) { _selectedDate = val; }

// ─────────────────────────────────────────
// Mini calendar sync
// ─────────────────────────────────────────
export function parseMonthCursorFromHeaderLabel(label) {
  const normalizedLabel = (label || '').trim().replace(/\s+/g, ' ');
  if (!normalizedLabel) return null;

  const parts = normalizedLabel.split(' ');
  let year = new Date().getFullYear();
  if (/^\d{4}$/.test(parts[parts.length - 1] || '')) {
    year = Number(parts.pop());
  }

  const monthIndex = localeMonthNames.indexOf(parts.join(' ').toLowerCase());
  if (monthIndex < 0) return null;

  return firstOfMonth(new Date(year, monthIndex, 1));
}

export function syncMiniCalendarToCentredMonthHeader() {
  const wrap = document.querySelector('.main-canvas-wrap');
  const monthHeader = document.getElementById('month-header');
  if (!wrap || !monthHeader) return;

  const monthTitleEls = [...monthHeader.querySelectorAll('.month-header-cell')];
  if (!monthTitleEls.length) return;

  const viewportCentreX = wrap.scrollLeft + (wrap.clientWidth / 2);
  let closestMonthTitle = null;
  let closestDistance = Infinity;

  monthTitleEls.forEach((monthTitleEl) => {
    const titleCentreX = monthTitleEl.offsetLeft + (monthTitleEl.offsetWidth / 2);
    const distance = Math.abs(titleCentreX - viewportCentreX);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMonthTitle = monthTitleEl;
    }
  });

  if (!closestMonthTitle) return;

  const nextMonthCursor = parseMonthCursorFromHeaderLabel(closestMonthTitle.textContent);
  if (!nextMonthCursor) return;

  if (toISODate(firstOfMonth(getMiniMonthCursor())) === toISODate(nextMonthCursor)) {
    return;
  }

  setMiniMonthCursor(nextMonthCursor);
  renderMiniCalendar();
}

export function scheduleMiniCalendarScrollSync() {
  if (miniCalendarScrollSyncRaf) return;
  miniCalendarScrollSyncRaf = window.requestAnimationFrame(() => {
    miniCalendarScrollSyncRaf = 0;
    syncMiniCalendarToCentredMonthHeader();
  });
}

// ─────────────────────────────────────────
// Sidebar rendering
// ─────────────────────────────────────────
export function renderMiniCalendar() {
  const miniCalendar = document.getElementById('mini-calendar');
  const miniLabel = document.getElementById('mini-month-label');
  const canvas = document.getElementById('main-canvas');
  if (!miniCalendar || !miniLabel) return;

  const monthStart = firstOfMonth(_miniMonthCursor);
  miniLabel.textContent = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  miniCalendar.style.opacity = '0';
  setTimeout(() => {
    miniCalendar.innerHTML = '';
    const itemCounts = new Map();
    getItems().forEach((calItem) => {
      itemCounts.set(calItem.date, (itemCounts.get(calItem.date) || 0) + 1);
    });

    const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekdayLabels.forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'mini-dow';
      cell.textContent = label;
      miniCalendar.appendChild(cell);
    });

    const gridStart = new Date(monthStart);
    const mondayFirstOffset = (monthStart.getDay() + 6) % 7;
    gridStart.setDate(monthStart.getDate() - mondayFirstOffset);

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const iso = toISODate(date);
      const btn = document.createElement('button');
      btn.className = 'mini-day';
      btn.textContent = String(date.getDate());
      if (date.getMonth() !== monthStart.getMonth()) btn.classList.add('outside');
      if (iso === toISODate(new Date())) btn.classList.add('today');
      if (itemCounts.has(iso)) btn.classList.add('has-event');
      const dow = new Date(iso + 'T00:00:00').getDay();
      const isHidden = (getHiddenDays().has(iso) || !getWorkingWeek().includes(dow)) && !getShownDays().has(iso);      
      if (isHidden) btn.classList.add('mini-day-hidden');
      if (isHidden) {
        btn.title = 'Hidden day';
      } else if (itemCounts.has(iso)) {
        const n = itemCounts.get(iso);
        btn.title = n === 1 ? '1 item' : `${n} items`;
      }
      btn.addEventListener('click', () => {
        const dow = new Date(iso + 'T00:00:00').getDay();
          if ((getHiddenDays().has(iso) || !getWorkingWeek().includes(dow)) && !getShownDays().has(iso)) {
            return;
          }
        const newCursor = firstOfMonth(date);
        const monthChanged = toISODate(newCursor) !== toISODate(_miniMonthCursor);
        _miniMonthCursor = newCursor;
        _selectedDate = iso;
        if (monthChanged) {
          _renderAll();
        } else {
          // Same month — flash the clicked day and fade it out
          miniCalendar.querySelectorAll('.mini-day.mini-day-flash').forEach((el) => el.classList.remove('mini-day-flash'));
          void btn.offsetWidth; // force reflow so animation restarts if same day is clicked again
          btn.classList.add('mini-day-flash');
          renderItemList();
        }
        scrollDateIntoView(iso);
        setTimeout(() => {
          if (!canvas) return;
          const card = canvas.querySelector(`.day-card[data-date="${iso}"]`);
          if (!card) return;
          card.classList.add('flash-locate');
          card.classList.add('day-card-actions-visible');
          setTimeout(() => {
            card.classList.remove('flash-locate');
            card.classList.remove('day-card-actions-visible');
          }, 2000);
        }, 600);
      });
      miniCalendar.appendChild(btn);
    }
    miniCalendar.style.opacity = '1';
  }, 200);
}

export function renderItemList() {
  const itemList = document.getElementById('event-list');
  if (!itemList) return;
  itemList.innerHTML = '';
  const includePast = document.getElementById('search-inc-past')?.checked || false;
  const includeNotes = document.getElementById('search-inc-notes')?.checked || false;
  let filtered = [...getItems()].sort(byItemDateTime);
  if (!includePast) {
    filtered = filtered.filter((e) => !e.date || e.date >= toISODate(new Date()));
  }
  if (selectedSidebarColourFilters.size > 0) {
    filtered = filtered.filter((e) => {
      const colour = normalizeStoredItemColour(e.user_colour);
      return selectedSidebarColourFilters.has(colour);
    });
  }
  if (activeSearchTerm) {
    filtered = filtered.filter((e) => itemMatchesSearch(e, activeSearchTerm, includeNotes));
  }
  filtered = filtered.slice(0, 200);

  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No upcoming items';
    itemList.appendChild(empty);
    return;
  }

  filtered.forEach((calItem) => {
    const row = document.createElement('article');
    row.className = 'event-row';
    row.dataset.date = calItem.date || '';
    row.style.borderLeftColor = getItemDisplayColour(calItem.user_colour);

    const main = document.createElement('div');
    main.className = 'event-row-main';
    const timeDisplay = calItem.is_all_day
      ? '<em>All Day</em>'
      : calItem.time
        ? escapeHtml(calItem.time)
        : '';
    const dateDisplay = calItem.date
      ? new Date(`${calItem.date}T00:00:00`).toLocaleDateString()
      : '<em>Later - no date</em>';
    main.innerHTML = `
      <h4>${escapeHtml(calItem.title)}</h4>
      <p>${dateDisplay}${calItem.date && timeDisplay ? ' - ' + timeDisplay : timeDisplay ? ' ' + timeDisplay : ''}</p>
    `;

    const actions = document.createElement('div');
    actions.className = 'event-row-actions';

    if (calItem.date) {
      const gotoButton = document.createElement('button');
      gotoButton.type = 'button';
      gotoButton.className = 'event-row-action-btn';
      gotoButton.textContent = 'Go to';
      gotoButton.addEventListener('click', () => {
        _miniMonthCursor = firstOfMonth(new Date(`${calItem.date}T00:00:00`));
        renderMiniCalendar();
        scrollDateIntoView(calItem.date);
        scheduleSidebarNavigationFlash(calItem.date, 'flash-locate');
      });
      actions.appendChild(gotoButton);
    }

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'event-row-action-btn';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => _openItemDialog(calItem));

    actions.append(editButton);
    row.append(main, actions);
    itemList.appendChild(row);
  });
}

export function renderItemFilterSwatches() {
  const itemFilterSwatches = document.getElementById('event-filter-swatches');
  if (!itemFilterSwatches) return;
  itemFilterSwatches.innerHTML = '';

  const allButton = document.createElement('button');
  allButton.id = 'event-filter-all';
  allButton.type = 'button';
  allButton.className = 'filter-reset-btn';
  allButton.textContent = 'All';
  allButton.classList.toggle('active', selectedSidebarColourFilters.size === 0);
  allButton.addEventListener('click', () => {
    selectedSidebarColourFilters.clear();
    renderItemFilterSwatches();
    renderItemList();
  });
  itemFilterSwatches.appendChild(allButton);

  const appendFilterSwatch = (slot) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'filter-swatch';
    swatch.style.background = slot.hex;
    swatch.title = slot.name;
    const label = document.createElement('span');
    label.className = 'swatch-label';
    label.textContent = slot.name;
    label.style.color = getContrastText(slot.hex);
    swatch.appendChild(label);
    const normalized = normalizeHex(slot.hex) || getDefaultItemColour();
    swatch.classList.toggle('selected', selectedSidebarColourFilters.has(normalized));
    swatch.addEventListener('click', () => {
      if (selectedSidebarColourFilters.has(normalized)) {
        selectedSidebarColourFilters.delete(normalized);
      } else {
        selectedSidebarColourFilters.add(normalized);
      }
      renderItemFilterSwatches();
      renderItemList();
    });
    itemFilterSwatches.appendChild(swatch);
  };

  getUserColours().slice(0, 4).forEach(appendFilterSwatch);

  const noneButton = document.createElement('button');
  noneButton.id = 'event-filter-none';
  noneButton.type = 'button';
  noneButton.className = 'filter-reset-btn';
  noneButton.textContent = 'None';
  const defaultColour = getDefaultItemColour();
  noneButton.classList.toggle('active', selectedSidebarColourFilters.has(defaultColour));
  noneButton.addEventListener('click', () => {
    if (selectedSidebarColourFilters.has(defaultColour)) {
      selectedSidebarColourFilters.delete(defaultColour);
    } else {
      selectedSidebarColourFilters.add(defaultColour);
    }
    renderItemFilterSwatches();
    renderItemList();
  });
  itemFilterSwatches.appendChild(noneButton);

  getUserColours().slice(4, 8).forEach(appendFilterSwatch);
}

export function renderCalendarSelector(ctx) {
  const calendarTrigger = document.getElementById('calendar-trigger');
  const calendarDropdown = document.getElementById('calendar-dropdown');
  if (!calendarTrigger || !calendarDropdown) return;

  document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());

  const active = getCalendars().find(c => Number(c.id) === getActiveCalendarId());
  calendarTrigger.textContent = active ? active.name : (getCalendars()[0]?.name || 'Default');

  calendarDropdown.innerHTML = '';
  getCalendars().forEach(cal => {
    const row = document.createElement('div');
    row.className = 'calendar-dropdown-item';
    if (Number(cal.id) === getActiveCalendarId()) row.classList.add('active');

    let calTip = null;
    row.addEventListener('mouseenter', () => {
      const span = row.querySelector('span');
      if (!span || span.scrollWidth <= span.clientWidth) return;
      calTip = document.createElement('div');
      calTip.className = 'calendar-tooltip';
      calTip.textContent = cal.name;
      document.body.appendChild(calTip);
      const rect = row.getBoundingClientRect();
      calTip.style.left = `${rect.right + 6}px`;
      calTip.style.top = `${rect.top + (rect.height / 2) - (calTip.offsetHeight / 2)}px`;
    });
    row.addEventListener('mouseleave', () => {
      if (calTip) { calTip.remove(); calTip = null; }
    });

    const label = document.createElement('span');
    label.textContent = cal.name;
    label.addEventListener('click', () => {
      setActiveCalendarId(Number(cal.id));
      loadHiddenDaysState();
      updateShowHiddenButton();
      loadCalendars();
      loadUserColoursFromCalendar();
      ctx.renderSwatches();
      ctx.renderPaletteEditor();
      renderCalendarSelector(ctx);
      calendarDropdown.classList.remove('open');
      document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());
      bootstrapDays({ rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd, activeCalendarId: getActiveCalendarId() });
      loadDays({ rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd });
      loadItems();
      ctx.renderAll();
      ctx.renderSeedDataRow();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'calendar-remove-btn';
    removeBtn.title = 'Remove calendar';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const answer = prompt(`Type "delete" to remove "${cal.name}":`);
      if (!answer || answer.trim().toLowerCase() !== 'delete') return;
      row.classList.remove('active');
      row.classList.add('deleting');
      showDeleteCalendarConfirm(cal.name, () => {
        removeCalendar(Number(cal.id), {
          seedInstalledKey,
          seedStartKey,
          renderSwatches,
          renderPaletteEditor,
          loadDays: ctx.loadDays,
          loadItems: ctx.loadItems,
          renderAll: ctx.renderAll,
          renderSeedDataRow,
          rangeStart: ctx.rangeStart,
          rangeEnd: ctx.rangeEnd,
          activeCalendarId: getActiveCalendarId(),
        });
        calendarDropdown?.classList.remove('open');
        document.querySelectorAll('.calendar-tooltip').forEach(t => t.remove());
        renderCalendarSelector(ctx);
      }, () => {
        row.classList.remove('deleting');
        if (Number(cal.id) === getActiveCalendarId()) row.classList.add('active');
      });
    });

    row.append(label, removeBtn);
    calendarDropdown.appendChild(row);
  });
}

function showDeleteCalendarConfirm(calName, onConfirm, onCancel) {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-delete-dialog';

  const msg = document.createElement('p');
  msg.textContent = `This will DELETE all items in "${calName}" and remove the calendar. Are you sure?`;

  const actions = document.createElement('div');
  actions.className = 'confirm-delete-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
    if (onCancel) onCancel();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'confirm-delete-btn';
  deleteBtn.textContent = `Delete ${calName}`;
  deleteBtn.addEventListener('click', () => {
    dialog.close();
    dialog.remove();
    onConfirm();
  });

  actions.append(cancelBtn, deleteBtn);
  dialog.append(msg, actions);
  document.body.appendChild(dialog);
  dialog.showModal();
}

export function scrollDateIntoView(iso) {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  const card = canvas.querySelector(`.day-card[data-date="${iso}"]`);
  if (!card) return;
  const wrap = canvas.closest('.main-canvas-wrap');
  if (!wrap) return;
  const cardLeft = card.closest('.day-column').offsetLeft;
  const columnWidth = card.closest('.day-column').offsetWidth;
  const wrapWidth = wrap.clientWidth;
  wrap.scrollTo({ left: cardLeft - (wrapWidth / 2) + (columnWidth / 2), behavior: 'smooth' });
}

export function flashDayCard(date, className) {
  if (!date || !className) return;
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  const card = canvas.querySelector(`.day-card[data-date="${date}"]`);
  if (!card) return;
  card.classList.add(className);
  setTimeout(() => card.classList.remove(className), DAY_CARD_FLASH_DURATION_MS);
}

export function jumpToToday() {
  const today = new Date();
  _selectedDate = toISODate(today);
  _miniMonthCursor = firstOfMonth(today);
  _renderAll();
  scrollDateIntoView(_selectedDate);
  scheduleSidebarNavigationFlash(_selectedDate, 'flash-locate');
}

// ─────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────
function scheduleSidebarNavigationFlash(date, className) {
  if (!date || !className) return;
  setTimeout(() => {
    flashDayCard(date, className);
    revealSidebarRowsForDate(date);
  }, DAY_CARD_FLASH_DELAY_MS);
}

function revealSidebarRowsForDate(date) {
  if (!date) return;
  const itemList = document.getElementById('event-list');
  if (!itemList) return;
  const rows = itemList.querySelectorAll(`.event-row[data-date="${date}"]`);
  rows.forEach((row) => {
    row.classList.add('event-row-actions-visible');
    setTimeout(() => row.classList.remove('event-row-actions-visible'), DAY_CARD_FLASH_DURATION_MS);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
