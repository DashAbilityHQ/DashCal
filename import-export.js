// import-export.js — DashCal import/export functionality
import { showStatus, recordExport } from './statusbar.js';
import {
  querySql, runSql, getItems, getDayMap, getDb, isUsingSqlRuntime,
  getActiveCalendarId, createSchema, persistDb, loadCalendars, loadDays,
  loadItems, setUndoStack, setRedoStack, bootstrapDays,
  normalizeStoredItemColour, byItemDateTime, addDaysToISODate, clamp, toISODate
} from './db.js';
import { updateUndoRedoButtons } from './toolbar.js';
import { renderCalendarSelector } from './sidebar.js';

// ─────────────────────────────────────────
// Module context (set via setupImportExport)
// ─────────────────────────────────────────
let _refs = null;
let _rangeStart = null;
let _rangeEnd = null;
let _makeRenderCtx = null;
let _makeSidebarCtx = null;

export function setupImportExport({ refs, rangeStart, rangeEnd, makeRenderCtx, makeSidebarCtx }) {
  _refs = refs;
  _rangeStart = rangeStart;
  _rangeEnd = rangeEnd;
  _makeRenderCtx = makeRenderCtx;
  _makeSidebarCtx = makeSidebarCtx;
}

// ─────────────────────────────────────────
// Export (.sql, .db, .ics)
// ─────────────────────────────────────────
export function exportSql() {
  const lines = [];

  const cals = querySql('SELECT id, name FROM calendars ORDER BY id ASC;');
  cals.forEach(cal => {
    const n = String(cal.name).replace(/'/g, "''");
    lines.push(`INSERT INTO calendars(id, name) VALUES(${Number(cal.id)}, '${n}');`);
  });

  const days = querySql('SELECT date, calendar_id, height_px FROM days ORDER BY date ASC;');
  days.forEach(day => {
    const d = String(day.date).replace(/'/g, "''");
    lines.push(`INSERT INTO days(date, calendar_id, height_px) VALUES('${d}', ${Number(day.calendar_id) || 0}, ${Math.round(Number(day.height_px)) || 110});`);
  });

  // Export includes is_all_day
  const evts = querySql('SELECT id, date, title, time, is_all_day, notes, user_colour, display_size, is_seed, calendar_id FROM events ORDER BY date ASC, time ASC, id ASC;');
  evts.forEach(e => {
    const esc = v => String(v ?? '').replace(/'/g, "''");
    lines.push(
      `INSERT INTO events(date, title, time, is_all_day, notes, user_colour, display_size, is_seed, calendar_id) VALUES('${esc(e.date)}', '${esc(e.title)}', '${esc(e.time)}', ${Number(e.is_all_day) || 0}, '${esc(e.notes)}', '${esc(e.user_colour)}', ${clamp(Math.round(Number(e.display_size) || 52), 35, 420)}, ${Number(e.is_seed) || 0}, ${Number(e.calendar_id) || 0});`
    );
  });

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'dashcal-export.sql';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  recordExport();
  showStatus('Database exported');
}

export function exportDb() {
  if (!isUsingSqlRuntime()) {
    alert('Database export requires the sql.js runtime, which is not currently loaded.');
    return;
  }
  const data = getDb().export();
  const blob = new Blob([data], { type: 'application/x-sqlite3' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'dashcal-export.db';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  recordExport();
  showStatus('Database exported');
}

export async function handleSqlFileInput(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  if (!isUsingSqlRuntime()) {
    alert('SQL import requires the sql.js runtime, which is not currently loaded.');
    event.target.value = '';
    return;
  }
  if (!confirm('This will replace all current data with the contents of this file. Continue?')) {
    event.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    getDb().run('DELETE FROM events;');
    getDb().run('DELETE FROM calendars;');
    getDb().run('DELETE FROM days;');

    const statements = text.split(';').map(s => s.trim()).filter(s => s.length > 0);
    statements.forEach(stmt => {
      try { getDb().run(stmt + ';'); } catch (e) { console.warn('SQL import skip:', e.message); }
    });

    // Run migrations in case the imported file is from an older version
    createSchema();
    persistDb();
    loadCalendars();
    loadDays({ rangeStart: _rangeStart, rangeEnd: _rangeEnd });
    loadItems();
    setUndoStack([]);
    setRedoStack([]);
    updateUndoRedoButtons();
    renderCalendarSelector(_makeSidebarCtx());
    const { renderAll } = _makeRenderCtx();
    renderAll(_makeRenderCtx());
  } catch (e) {
    console.error('SQL import failed:', e);
  } finally {
    event.target.value = '';
  }
}

export async function handleDbFileInput(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  if (!isUsingSqlRuntime()) {
    alert('Database import requires the sql.js runtime, which is not currently loaded.');
    event.target.value = '';
    return;
  }
  if (!confirm('This will replace all current data with the contents of this file. Continue?')) {
    event.target.value = '';
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const SQL = (await import('./db.js')).getSQL();
    if (!SQL) throw new Error('SQL not available');
    const db = new SQL.Database(data);
    const { setDb } = await import('./db.js');
    setDb(db);
    createSchema();
    persistDb();
    loadCalendars();
    loadDays({ rangeStart: _rangeStart, rangeEnd: _rangeEnd });
    loadItems();
    setUndoStack([]);
    setRedoStack([]);
    updateUndoRedoButtons();
    renderCalendarSelector(_makeSidebarCtx());
    const { renderAll } = _makeRenderCtx();
    renderAll(_makeRenderCtx());
  } catch (e) {
    console.error('DB import failed:', e);
  } finally {
    event.target.value = '';
  }
}

export function exportIcs() {
  if (!getItems().length) {
    return;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DashCal//DashCal//EN'
  ];

  const ordered = [...getItems()].filter(e => Boolean(e.date)).sort(byItemDateTime);
  ordered.forEach((calItem) => {
    const hasTime = Boolean((calItem.time || '').trim());
    const isAllDay = Boolean(calItem.is_all_day);
    const itemColour = normalizeStoredItemColour(calItem.user_colour);
    const itemHeight = Number.parseInt(calItem.display_size, 10) || 52;
    const dayHeight = getDayMap().get(calItem.date)?.height_px ?? 110;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${calItem.id}@dashcal`);

    if (isAllDay) {
      const startDate = toIcsDate(calItem.date);
      const endDate = toIcsDate(addDaysToISODate(calItem.date, 1));
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${endDate}`);
    } else if (hasTime) {
      const startStamp = toIcsDateTimeLocal(calItem.date, calItem.time);
      const end = addMinutesToDateTime(calItem.date, calItem.time, 60);
      const endStamp = toIcsDateTimeLocal(end.date, end.time);
      lines.push(`DTSTART:${startStamp}`);
      lines.push(`DTEND:${endStamp}`);
    } else {
      // Untimed: export as date-only so it round-trips correctly
      const startDate = toIcsDate(calItem.date);
      const endDate = toIcsDate(addDaysToISODate(calItem.date, 1));
      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${endDate}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(calItem.title || '')}`);
    if (calItem.notes) {
      const notes = String(calItem.notes || '')
        .replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\\n');
      lines.push(`DESCRIPTION:${escapeIcsText(notes)}`);
    }
    lines.push(`X-DASHCAL-COLOUR:${itemColour}`);
    lines.push(`X-DASHCAL-EVENT-HEIGHT:${itemHeight}`);
    lines.push(`X-DASHCAL-DAY-HEIGHT:${dayHeight}`);
    lines.push(`X-DASHCAL-CALENDAR-ID:${Number(calItem.calendar_id) || 0}`);
    lines.push(`X-DASHCAL-IS-ALL-DAY:${isAllDay ? 1 : 0}`);
    if (Number(calItem.is_seed)) lines.push('X-DASHCAL-IS-SEED:1');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');

  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = 'dashcal-export.ics';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
  recordExport();
  showStatus('Calendar exported');
}

// ─────────────────────────────────────────
// ICS parsing
// ─────────────────────────────────────────
export function parseIcsEvents(text) {
  const normalized = String(text || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '');
  const blocks = normalized.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gim) || [];
  const parsed = [];

  blocks.forEach((block) => {
    const row = {
      summary: '', description: '', dtstart: null, dtend: null,
      userColour: '', eventHeight: null, dayHeight: null,
      calendarId: null, isSeed: 0, isAllDay: 0
    };

    const lines = block.split(/\r?\n/);
    lines.forEach((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex <= 0) return;
      const rawName = line.slice(0, colonIndex).trim();
      const rawValue = line.slice(colonIndex + 1).trim();
      const [propName, ...paramParts] = rawName.split(';');
      const name = propName.toUpperCase();
      const paramsRaw = paramParts.join(';');

      if (name === 'SUMMARY') row.summary = unescapeIcsText(rawValue).trim();
      else if (name === 'DESCRIPTION') row.description = unescapeIcsText(rawValue).replaceAll('\\n', '\n');
      else if (name === 'DTSTART') row.dtstart = parseIcsDateValue(rawValue, paramsRaw);
      else if (name === 'DTEND') row.dtend = parseIcsDateValue(rawValue, paramsRaw);
      else if (name === 'X-DASHCAL-COLOUR') row.userColour = rawValue.trim();
      else if (name === 'X-DASHCAL-EVENT-HEIGHT') row.eventHeight = Number.parseInt(rawValue, 10);
      else if (name === 'X-DASHCAL-DAY-HEIGHT') row.dayHeight = Number.parseFloat(rawValue);
      else if (name === 'X-DASHCAL-CALENDAR-ID') row.calendarId = Number.parseInt(rawValue, 10);
      else if (name === 'X-DASHCAL-IS-SEED') row.isSeed = Number.parseInt(rawValue, 10) || 0;
      else if (name === 'X-DASHCAL-IS-ALL-DAY') row.isAllDay = Number.parseInt(rawValue, 10) || 0;
    });

    if (!row.summary || !row.dtstart?.date) return;

    // If the ICS file marks it as all-day (VALUE=DATE), and we don't have an
    // explicit X-DASHCAL-IS-ALL-DAY override, use the ICS signal.
    const resolvedAllDay = row.isAllDay || (row.dtstart.isAllDay ? 1 : 0);

    const parsedEventHeight = Number.isFinite(row.eventHeight) && row.eventHeight >= 35
      ? Math.round(row.eventHeight) : 52;
    const parsedDayHeight = Number.isFinite(row.dayHeight)
      ? clamp(Math.round(row.dayHeight <= 10 ? row.dayHeight * 110 : row.dayHeight), 110, 1100)
      : 110;

    parsed.push({
      date: row.dtstart.date,
      time: resolvedAllDay ? '' : (row.dtstart.time || ''),
      is_all_day: resolvedAllDay,
      title: row.summary,
      notes: row.description || '',
      user_colour: normalizeStoredItemColour(row.userColour),
      display_size: parsedEventHeight,
      day_height: parsedDayHeight,
      calendar_id: Number.isFinite(row.calendarId) ? row.calendarId : null,
      is_seed: row.isSeed ? 1 : 0
    });
  });

  return parsed;
}

export function parseIcsDateValue(raw, paramsRaw) {
  const value = String(raw || '').trim();
  const params = String(paramsRaw || '').toUpperCase();
  const compact = value.replace(/[^0-9T]/g, '');
  const isDateOnly = params.includes('VALUE=DATE') || /^\d{8}$/.test(compact);

  if (isDateOnly) {
    const dateMatch = compact.match(/^(\d{8})/);
    if (!dateMatch) return null;
    const datePart = dateMatch[1];
    return {
      date: `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`,
      time: '',
      isAllDay: true
    };
  }

  const dateTimeMatch = compact.match(/^(\d{8})T(\d{4})/);
  if (!dateTimeMatch) return null;
  const [, datePart, timePart] = dateTimeMatch;
  return {
    date: `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`,
    time: `${timePart.slice(0, 2)}:${timePart.slice(2, 4)}`,
    isAllDay: false
  };
}

export async function handleIcsFileInput(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsedItems = parseIcsEvents(text);
    if (!parsedItems.length) return;

    const existingKeys = new Set(
      getItems().map((e) => `${e.date}|${(e.time || '').trim()}|${(e.title || '').trim().toLowerCase()}`)
    );
    const duplicates = parsedItems.filter((e) =>
      existingKeys.has(`${e.date}|${(e.time || '').trim()}|${(e.title || '').trim().toLowerCase()}`)
    );
    if (duplicates.length > 0) {
      const confirmed = window.confirm(
        `${duplicates.length} item${duplicates.length > 1 ? 's' : ''} in this file appear to already exist. Continue with import? This will replace items in the current calendar.`
      );
      if (!confirmed) return;
    }

    const calId = getActiveCalendarId() || 0;
    runSql('DELETE FROM events WHERE calendar_id = ?;', [calId]);
    bootstrapDays({ rangeStart: _rangeStart, rangeEnd: _rangeEnd, activeCalendarId: getActiveCalendarId() });

    const dayHeightByDate = new Map();
    parsedItems.forEach((itemRow) => {
      const dateKey = itemRow.date;
      const nextHeight = Number.isFinite(itemRow.day_height) ? clamp(Math.round(itemRow.day_height), 110, 1100) : 110;
      const previousHeight = dayHeightByDate.get(dateKey) ?? 110;
      dayHeightByDate.set(dateKey, Math.max(previousHeight, nextHeight));

      const itemCalId = (itemRow.calendar_id != null) ? itemRow.calendar_id : calId;
      runSql(
        'INSERT INTO events(date, title, time, is_all_day, notes, user_colour, display_size, is_seed, calendar_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);',
        [
          itemRow.date, itemRow.title,
          itemRow.is_all_day ? '' : (itemRow.time || ''),
          itemRow.is_all_day ? 1 : 0,
          itemRow.notes,
          normalizeStoredItemColour(itemRow.user_colour),
          Number.isFinite(itemRow.display_size) && itemRow.display_size >= 35 ? itemRow.display_size : 52,
          itemRow.is_seed || 0,
          itemCalId
        ]
      );
    });

    dayHeightByDate.forEach((height, date) => {
      runSql(
        'INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, ?) ON CONFLICT(date, calendar_id) DO UPDATE SET height_px=excluded.height_px;',
        [date, calId, height]
      );
      if (getDayMap().has(date)) getDayMap().get(date).height_px = height;
      else getDayMap().set(date, { height_px: height });
    });

    persistDb();
    loadDays({ rangeStart: _rangeStart, rangeEnd: _rangeEnd });
    loadItems();
    setUndoStack([]);
    setRedoStack([]);
    updateUndoRedoButtons();
    const { renderAll } = _makeRenderCtx();
    renderAll(_makeRenderCtx());
  } catch (error) {
    console.error(error);
  } finally {
    if (input) input.value = '';
  }
}

// ─────────────────────────────────────────
// ICS utilities
// ─────────────────────────────────────────
export function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function toIcsDate(isoDate) {
  return String(isoDate || '').replaceAll('-', '');
}

export function toIcsDateTimeLocal(isoDate, time) {
  const safeTime = (time || '00:00').slice(0, 5);
  const [hour, minute] = safeTime.split(':');
  return `${toIcsDate(isoDate)}T${String(hour || '00').padStart(2, '0')}${String(minute || '00').padStart(2, '0')}00`;
}

export function addMinutesToDateTime(isoDate, time, deltaMinutes) {
  const [hourRaw, minuteRaw] = (time || '00:00').split(':');
  const date = new Date(`${isoDate}T${String(hourRaw || '00').padStart(2, '0')}:${String(minuteRaw || '00').padStart(2, '0')}:00`);
  date.setMinutes(date.getMinutes() + deltaMinutes);
  return {
    date: toISODate(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  };
}
