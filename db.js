// db.js — DashCal module: constants, shared state, and persistence functions
import { showStatus } from './statusbar.js';

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

export const DB_STORAGE_KEY        = 'dashcal-sqlite-v1';
export const LOCAL_DB_STORAGE_KEY  = 'dashcal-localdb-v1';
export const MAX_UNDO_STACK_DEPTH  = 50;
export const DEFAULT_COLOURS = [
  { name: 'Content',    hex: '#81BB95' },
  { name: 'Finance',    hex: '#EAC96A' },
  { name: 'Urgent',     hex: '#DC7F79' },
  { name: 'Operations', hex: '#6178A0' },
  { name: 'Product',    hex: '#E08C46' },
  { name: 'Marketing',  hex: '#6FB7C3' },
  { name: 'Personal',   hex: '#A47F9B' },
  { name: 'Admin',      hex: '#AA9B87' }
];

export const SEED_INSTALLED_KEY = 'dashcal-seed-installed-v2';
export const SEED_START_KEY     = 'dashcal-seed-start-v2';

// ─────────────────────────────────────────
// Mutable state
// ─────────────────────────────────────────

let SQL = null;
let db = null;
let usingSqlRuntime = false;
let items = [];
let dayMap = new Map();
let userColours = [];
let calendars = [];
let activeCalendarId = null;
let undoStack = [];
let redoStack = [];

// ─────────────────────────────────────────
// State accessors
// ─────────────────────────────────────────

export function getSQL() { return SQL; }
export function setSQL(val) { SQL = val; }
export function getDb() { return db; }
export function setDb(val) { db = val; }
export function isUsingSqlRuntime() { return usingSqlRuntime; }
export function setUsingSqlRuntime(val) { usingSqlRuntime = val; }
export function getItems() { return items; }
export function getDayMap() { return dayMap; }
export function getCalendars() { return calendars; }
export function getActiveCalendarId() { return activeCalendarId; }
export function setActiveCalendarId(val) { activeCalendarId = val; }
export function getUndoStack() { return undoStack; }
export function setUndoStack(val) { undoStack = val; }
export function getRedoStack() { return redoStack; }
export function setRedoStack(val) { redoStack = val; }
export function getUserColours() { return userColours; }
export function setUserColours(val) { userColours = val; }

// ─────────────────────────────────────────
// Pure utility helpers
// ─────────────────────────────────────────

export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatFriendlyDate(isoStr) {
  const d = new Date(`${isoStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoStr;
  const day = d.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function firstOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
export function addMonths(date, delta) { return new Date(date.getFullYear(), date.getMonth() + delta, 1); }
export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
export function addDaysToISODate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function normalizeHex(input) {
  if (!input) return null;
  const raw = input.trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

export function getDefaultItemColour() { return '#D1D1D1'; }

export function normalizeStoredItemColour(input) {
  const normalized = normalizeHex(input);
  if (!normalized) return getDefaultItemColour();
  if (normalized === '#4A4A4A') return getDefaultItemColour();
  return normalized;
}

export function getItemDisplayColour(colourInput) {
  return normalizeHex(colourInput) || getDefaultItemColour();
}

export function byItemDateTime(a, b) {
  return `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`);
}

/**
 * Clone an item for undo/redo.
 * Includes is_all_day so state is fully preserved across undo operations.
 */
export function cloneItem(calItem) {
  if (!calItem) return null;
  return {
    id: Number(calItem.id),
    date: calItem.date || '',
    title: calItem.title,
    time: calItem.time || '',
    is_all_day: Boolean(calItem.is_all_day),
    notes: calItem.notes || '',
    user_colour: normalizeStoredItemColour(calItem.user_colour),
    display_size: clamp(Math.round(Number(calItem.display_size) || 52), 35, 420),
    calendar_id: calItem.calendar_id || 0
  };
}

// ─────────────────────────────────────────
// Undo / redo
// ─────────────────────────────────────────

export function pushUndoEntry(entry, { clearRedo = true } = {}) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO_STACK_DEPTH) undoStack.shift();
  if (clearRedo) redoStack = [];
}

export function pushRedoEntry(entry) {
  redoStack.push(entry);
}

export function applyAction(action, mode) {
  if (action.type === 'item_add') {
    if (mode === 'undo') applyItemDelete(action.item);
    else applyItemInsert(action.item);
  } else if (action.type === 'item_edit') {
    if (mode === 'undo') applyItemUpdate(action.before);
    else applyItemUpdate(action.after);
  } else if (action.type === 'item_delete') {
    if (mode === 'undo') applyItemInsert(action.item);
    else applyItemDelete(action.item);
  } else if (action.type === 'palette_edit') {
    const target = mode === 'undo' ? action.before : action.after;
    const previous = mode === 'undo' ? action.after : action.before;
    userColours[action.index] = { name: target.name, hex: target.hex };
    saveUserColoursToDB();

    const affectedItems = items.filter(
      (e) => (normalizeHex(e.user_colour) || '').toUpperCase() === previous.hex.toUpperCase()
    );
    affectedItems.forEach((e) => {
      runSql('UPDATE events SET user_colour = ? WHERE id = ?;', [target.hex, Number(e.id)]);
    });
    if (affectedItems.length) {
      persistDb();
      loadItems();
    }
  } else if (action.type === 'day_resize') {
    if (mode === 'undo') applyDayResize(action.date, action.before);
    else applyDayResize(action.date, action.after);
  } else if (action.type === 'push') {
    const targets = mode === 'undo' ? action.changes.map((c) => c.before) : action.changes.map((c) => c.after);
    for (const item of targets) applyItemUpdate(item);
  }
  return action?.type;
}

export function applyItemInsert(calItem) {
  runSql(
    'INSERT INTO events(id, date, title, time, is_all_day, notes, user_colour, display_size, calendar_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);',
    [calItem.id, calItem.date, calItem.title, calItem.time, calItem.is_all_day ? 1 : 0, calItem.notes, calItem.user_colour, clamp(Math.round(Number(calItem.display_size) || 52), 35, 420), calItem.calendar_id || activeCalendarId || 0]
  );
}

export function applyItemUpdate(calItem) {
  runSql(
    'UPDATE events SET date = ?, title = ?, time = ?, is_all_day = ?, notes = ?, user_colour = ?, display_size = ? WHERE id = ?;',
    [calItem.date, calItem.title, calItem.time, calItem.is_all_day ? 1 : 0, calItem.notes, calItem.user_colour, clamp(Math.round(Number(calItem.display_size) || 52), 35, 420), calItem.id]
  );
}

export function applyItemDelete(calItem) {
  runSql('DELETE FROM events WHERE id = ?;', [calItem.id]);
}

export function applyDayResize(date, height_px) {
  const day = dayMap.get(date);
  if (day) day.height_px = clamp(Math.round(Number(height_px)), 110, 1100);
  runSql(
    'INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, ?) ON CONFLICT(date, calendar_id) DO UPDATE SET height_px=excluded.height_px;',
    [date, activeCalendarId || 0, clamp(Math.round(Number(height_px)), 110, 1100)]
  );
}

// ─────────────────────────────────────────
// Data & persistence
// ─────────────────────────────────────────

export function loadDays({ rangeStart, rangeEnd } = {}) {
  dayMap.clear();
  const calId = activeCalendarId || 0;
  const rows = querySql('SELECT date, height_px FROM days WHERE calendar_id = ? ORDER BY date ASC;', [calId]);
  rows.forEach((row) => dayMap.set(row.date, { height_px: clamp(Math.round(Number(row.height_px)), 110, 1100) }));
  const rangeStartIso = toISODate(rangeStart);
  const rangeEndIso = toISODate(rangeEnd);
  dayMap.forEach((value, key) => {
    if (key < rangeStartIso || key > rangeEndIso) dayMap.delete(key);
  });
}

export function loadItems() {
  const calId = activeCalendarId || 0;
  const rows = querySql(
    'SELECT id, date, title, time, is_all_day, notes, user_colour, display_size, is_seed, calendar_id FROM events WHERE calendar_id = ? ORDER BY date ASC, time ASC, id ASC;',
    [calId]
  );
  let migrated = false;

  items = rows.map((row) => {
    const normalizedInput = normalizeHex(row.user_colour);
    const storedColour = normalizeStoredItemColour(row.user_colour);
    if (normalizedInput !== storedColour) {
      runSql('UPDATE events SET user_colour = ? WHERE id = ?;', [storedColour, Number(row.id)]);
      migrated = true;
    }

    return {
      ...row,
      user_colour: storedColour,
      // is_all_day comes from DB as 0/1; coerce to boolean for convenience
      is_all_day: Boolean(Number(row.is_all_day)),
      display_size: clamp(Math.round(Number(row.display_size) || 52), 35, 420)
    };
  });

  if (migrated) persistDb();
}

export function loadCalendars() {
  calendars = querySql(
    'SELECT id, name, colour_1_hex, colour_1_name, colour_2_hex, colour_2_name, ' +
    'colour_3_hex, colour_3_name, colour_4_hex, colour_4_name, colour_5_hex, colour_5_name, ' +
    'colour_6_hex, colour_6_name, colour_7_hex, colour_7_name, colour_8_hex, colour_8_name ' +
    'FROM calendars ORDER BY id ASC;'
  );
  if (calendars.length) {
    const stillExists = calendars.some(c => Number(c.id) === activeCalendarId);
    if (!activeCalendarId || !stillExists) {
      activeCalendarId = Number(calendars[0].id);
    }
  } else {
    activeCalendarId = null;
  }
  loadUserColoursFromCalendar();
}

export function ensureDefaultCalendar() {
  const existing = querySql('SELECT id FROM calendars LIMIT 1;');
  if (!existing.length) {
    const colParams = [];
    for (let i = 0; i < 8; i++) colParams.push(DEFAULT_COLOURS[i].hex, DEFAULT_COLOURS[i].name);
    if (usingSqlRuntime) {
      db.run(
        'INSERT INTO calendars(name, colour_1_hex, colour_1_name, colour_2_hex, colour_2_name, ' +
        'colour_3_hex, colour_3_name, colour_4_hex, colour_4_name, colour_5_hex, colour_5_name, ' +
        'colour_6_hex, colour_6_name, colour_7_hex, colour_7_name, colour_8_hex, colour_8_name) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        ['Default', ...colParams]
      );
    } else {
      if (!db.calendars) db.calendars = [];
      if (!db.nextCalendarId) db.nextCalendarId = 1;
      const entry = { id: db.nextCalendarId++, name: 'Default' };
      for (let i = 0; i < 8; i++) {
        entry[`colour_${i + 1}_hex`] = DEFAULT_COLOURS[i].hex;
        entry[`colour_${i + 1}_name`] = DEFAULT_COLOURS[i].name;
      }
      db.calendars.push(entry);
    }
    persistDb();
  }
}

export function addCalendar(name) {
  const colParams = [];
  for (let i = 0; i < 8; i++) colParams.push(DEFAULT_COLOURS[i].hex, DEFAULT_COLOURS[i].name);
  if (usingSqlRuntime) {
    db.run(
      'INSERT INTO calendars(name, colour_1_hex, colour_1_name, colour_2_hex, colour_2_name, ' +
      'colour_3_hex, colour_3_name, colour_4_hex, colour_4_name, colour_5_hex, colour_5_name, ' +
      'colour_6_hex, colour_6_name, colour_7_hex, colour_7_name, colour_8_hex, colour_8_name) ' +
      'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [name, ...colParams]
    );
  } else {
    if (!db.calendars) db.calendars = [];
    if (!db.nextCalendarId) db.nextCalendarId = 1;
    const entry = { id: db.nextCalendarId++, name };
    for (let i = 0; i < 8; i++) {
      entry[`colour_${i + 1}_hex`] = DEFAULT_COLOURS[i].hex;
      entry[`colour_${i + 1}_name`] = DEFAULT_COLOURS[i].name;
    }
    db.calendars.push(entry);
  }
  persistDb();
  loadCalendars();
  showStatus('Calendar created');
}

export function removeCalendar(id, ctx) {
  if (usingSqlRuntime) {
    db.run('DELETE FROM events WHERE calendar_id = ?;', [id]);
    db.run('DELETE FROM days WHERE calendar_id = ?;', [id]);
    db.run('DELETE FROM day_visibility WHERE calendar_id = ?;', [id]);
    db.run('DELETE FROM calendars WHERE id = ?;', [id]);
    const remaining = db.exec('SELECT COUNT(*) as count FROM calendars;');
    const count = remaining[0]?.values[0][0] ?? 0;
    if (count === 0) {
      db.run("INSERT INTO calendars (name) VALUES ('Default');");
      persistDb();
      window.location.reload();
      return;
    }
  } else {
    if (db.items) db.items = db.items.filter(e => Number(e.calendar_id) !== id);
    if (db.days) db.days = db.days.filter(d => Number(d.calendar_id) !== id);
    if (db.day_visibility) db.day_visibility = db.day_visibility.filter(r => Number(r.calendar_id) !== id);
    if (db.calendars) db.calendars = db.calendars.filter(c => Number(c.id) !== id);
    if (!db.calendars || db.calendars.length === 0) {
      db.calendars = [{ id: 1, name: 'Default' }];
      persistDb();
      window.location.reload();
      return;
    }
  }
  persistDb();
  localStorage.removeItem(ctx.seedInstalledKey(Number(id)));
  localStorage.removeItem(ctx.seedStartKey(Number(id)));
  loadCalendars();
  ctx.renderSwatches();
  ctx.renderPaletteEditor();
  ctx.loadDays({ rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd });
  ctx.loadItems();
  ctx.renderAll();
  ctx.renderSeedDataRow({ activeCalendarId: ctx.activeCalendarId });
  showStatus('Calendar deleted');
}

export function loadUserColours() {
  // No-op: colours are now loaded from the active calendar's DB columns via loadCalendars().
}

export function loadUserColoursFromCalendar() {
  const cal = calendars.find(c => Number(c.id) === activeCalendarId);
  if (!cal) {
    userColours = DEFAULT_COLOURS.map(c => ({ ...c }));
    return;
  }

  const allNull = [1, 2, 3, 4, 5, 6, 7, 8].every(
    i => cal[`colour_${i}_hex`] == null && cal[`colour_${i}_name`] == null
  );

  if (allNull) {
    userColours = DEFAULT_COLOURS.map(c => ({ ...c }));
    saveUserColoursToDB();
    return;
  }

  userColours = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
    hex: normalizeHex(cal[`colour_${i}_hex`]) || DEFAULT_COLOURS[i - 1].hex,
    name: cal[`colour_${i}_name`] || DEFAULT_COLOURS[i - 1].name
  }));
}

export function saveUserColoursToDB() {
  if (!activeCalendarId) return;
  const colParams = [];
  for (let i = 0; i < 8; i++) {
    colParams.push(userColours[i]?.hex || DEFAULT_COLOURS[i].hex);
    colParams.push(userColours[i]?.name || DEFAULT_COLOURS[i].name);
  }
  runSql(
    'UPDATE calendars SET colour_1_hex=?, colour_1_name=?, colour_2_hex=?, colour_2_name=?, colour_3_hex=?, colour_3_name=?, colour_4_hex=?, colour_4_name=?, colour_5_hex=?, colour_5_name=?, colour_6_hex=?, colour_6_name=?, colour_7_hex=?, colour_7_name=?, colour_8_hex=?, colour_8_name=? WHERE id=?;',
    [...colParams, activeCalendarId]
  );
  persistDb();
}

export function loadDbFromStorage() {
  const saved = localStorage.getItem(DB_STORAGE_KEY);
  if (!saved) return new SQL.Database();
  const bytes = Uint8Array.from(atob(saved), (char) => char.charCodeAt(0));
  return new SQL.Database(bytes);
}

export function loadLocalDbFromStorage() {
  const raw = localStorage.getItem(LOCAL_DB_STORAGE_KEY);
  if (!raw) return { days: [], events: [], nextEventId: 1 };

  try {
    const parsed = JSON.parse(raw);

    let safeDays;
    if (Array.isArray(parsed?.days)) {
      safeDays = parsed.days.map(d => {
        if (d.height_px != null) return d;
        const m = Number(d.height_multiplier) || 1;
        return { ...d, height_px: clamp(Math.round(m * 110), 110, 1100) };
      });
    } else if (parsed?.days && typeof parsed.days === 'object') {
      safeDays = Object.entries(parsed.days).map(([date, val]) => {
        const m = Number(val?.height_multiplier) || 1;
        return { date, calendar_id: 0, height_px: clamp(Math.round(m * 110), 110, 1100) };
      });
    } else {
      safeDays = [];
    }

    const safeEvents = Array.isArray(parsed?.events) ? parsed.events : [];
    const highestId = safeEvents.reduce((maxId, event) => Math.max(maxId, Number(event.id) || 0), 0);
    const parsedNext = Number(parsed?.nextEventId) || 0;
    const safeDayVisibility = Array.isArray(parsed?.day_visibility) ? parsed.day_visibility : [];
    const highestDvId = safeDayVisibility.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0);

    return {
      days: safeDays,
      events: safeEvents.map((event) => ({
        ...event,
        is_all_day: Number(event.is_all_day) || 0,
        display_size: clamp(Math.round(Number(event?.display_size) || 52), 35, 420)
      })),
      nextEventId: Math.max(parsedNext, highestId + 1, 1),
      calendars: parsed?.calendars || [],
      nextCalendarId: parsed?.nextCalendarId || 1,
      day_visibility: safeDayVisibility,
      nextDayVisibilityId: Math.max(Number(parsed?.nextDayVisibilityId) || 0, highestDvId + 1, 1)
    };
  } catch {
    return { days: [], events: [], nextEventId: 1, day_visibility: [], nextDayVisibilityId: 1 };
  }
}

export function persistDb() {
  if (usingSqlRuntime) {
    const data = db.export();
    let binaryString = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
      binaryString += String.fromCharCode(...data.subarray(i, i + chunkSize));
    }
    localStorage.setItem(DB_STORAGE_KEY, btoa(binaryString));
    return Promise.resolve();
  }
  localStorage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(db));
  return Promise.resolve();
}

export function runSql(sql, params = []) {
  if (usingSqlRuntime) {
    db.run(sql, params);
    return;
  }

  const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  if (normalized.startsWith('CREATE TABLE IF NOT EXISTS DAYS')) return;
  if (normalized.startsWith('CREATE TABLE IF NOT EXISTS EVENTS')) return;
  if (normalized.startsWith('CREATE TABLE IF NOT EXISTS CALENDARS')) {
    if (!db.calendars) db.calendars = [];
    if (!db.nextCalendarId) db.nextCalendarId = 1;
    return;
  }
  if (normalized.startsWith('CREATE TABLE IF NOT EXISTS DAY_VISIBILITY')) {
    if (!db.day_visibility) db.day_visibility = [];
    if (!db.nextDayVisibilityId) db.nextDayVisibilityId = 1;
    return;
  }

  if (normalized.startsWith('ALTER TABLE EVENTS ADD COLUMN DISPLAY_SIZE INTEGER NOT NULL DEFAULT 52')) {
    db.events = db.events.map((event) => ({ ...event, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }));
    return;
  }

  if (normalized.startsWith('ALTER TABLE EVENTS ADD COLUMN IS_SEED')) {
    db.events = db.events.map((event) => ({ ...event, is_seed: event.is_seed || 0 }));
    return;
  }

  if (normalized.startsWith('ALTER TABLE EVENTS ADD COLUMN IS_ALL_DAY')) {
    // Migrate existing items: preserve no-time as untimed (is_all_day=0), not all-day
    db.events = db.events.map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0 }));
    return;
  }

  if (normalized.startsWith('ALTER TABLE EVENTS ADD COLUMN CALENDAR_ID')) {
    db.events = db.events.map((event) => ({ ...event, calendar_id: event.calendar_id || 0 }));
    return;
  }

  if (normalized.startsWith('UPDATE EVENTS SET CALENDAR_ID = ? WHERE CALENDAR_ID = 0')) {
    const [calId] = params;
    db.events.forEach(e => {
      if (!e.calendar_id || Number(e.calendar_id) === 0) e.calendar_id = Number(calId);
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO DAYS(DATE, CALENDAR_ID, HEIGHT_PX) VALUES(?, ?, 110) ON CONFLICT(DATE, CALENDAR_ID) DO NOTHING')) {
    const [date, calId] = params;
    const cid = Number(calId) || 0;
    if (date && !db.days.find(d => d.date === date && Number(d.calendar_id) === cid)) {
      db.days.push({ date, calendar_id: cid, height_px: 110 });
    }
    return;
  }

  if (normalized.startsWith('INSERT INTO DAYS(DATE, CALENDAR_ID, HEIGHT_PX) VALUES(?, ?, ?) ON CONFLICT(DATE, CALENDAR_ID) DO UPDATE SET HEIGHT_PX=EXCLUDED.HEIGHT_PX')) {
    const [date, calId, height] = params;
    if (!date) return;
    const cid = Number(calId) || 0;
    const existing = db.days.find(d => d.date === date && Number(d.calendar_id) === cid);
    if (existing) {
      existing.height_px = clamp(Math.round(Number(height)), 110, 1100);
    } else {
      db.days.push({ date, calendar_id: cid, height_px: clamp(Math.round(Number(height)), 110, 1100) });
    }
    return;
  }

  if (normalized.startsWith('INSERT INTO DAYS(DATE, HEIGHT_PX) VALUES(?, 110) ON CONFLICT(DATE) DO NOTHING')) {
    const [date] = params;
    const cid = activeCalendarId || 0;
    if (date && !db.days.find(d => d.date === date && Number(d.calendar_id) === cid)) {
      db.days.push({ date, calendar_id: cid, height_px: 110 });
    }
    return;
  }

  if (normalized.startsWith('INSERT INTO DAYS(DATE, HEIGHT_PX) VALUES(?, ?) ON CONFLICT(DATE) DO UPDATE SET HEIGHT_PX=EXCLUDED.HEIGHT_PX')) {
    const [date, height] = params;
    if (!date) return;
    const cid = activeCalendarId || 0;
    const existing = db.days.find(d => d.date === date && Number(d.calendar_id) === cid);
    if (existing) {
      existing.height_px = clamp(Math.round(Number(height)), 110, 1100);
    } else {
      db.days.push({ date, calendar_id: cid, height_px: clamp(Math.round(Number(height)), 110, 1100) });
    }
    return;
  }

  if (normalized.startsWith('UPDATE DAYS SET HEIGHT_PX = 110 WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    const cid = Number(calId) || 0;
    db.days.forEach(d => { if (Number(d.calendar_id) === cid) d.height_px = 110; });
    return;
  }

  if (normalized === 'UPDATE DAYS SET HEIGHT_PX = 110;') {
    db.days.forEach(d => { d.height_px = 110; });
    return;
  }

  if (normalized === 'DELETE FROM DAYS;') { db.days = []; return; }

  if (normalized.startsWith('UPDATE DAYS SET CALENDAR_ID = ? WHERE CALENDAR_ID = 0')) {
    const [calId] = params;
    db.days.forEach(d => {
      if (!d.calendar_id || Number(d.calendar_id) === 0) d.calendar_id = Number(calId);
    });
    return;
  }

  if (normalized === 'DELETE FROM EVENTS;') {
    db.events = [];
    db.nextEventId = 1;
    return;
  }

  if (normalized.startsWith('DELETE FROM EVENTS WHERE ID = ?')) {
    const [id] = params;
    db.events = db.events.filter((event) => Number(event.id) !== Number(id));
    return;
  }

  if (normalized.startsWith('DELETE FROM EVENTS WHERE IS_SEED')) {
    db.events = db.events.filter((event) => Number(event.is_seed) !== 1);
    return;
  }

  if (normalized.startsWith('DELETE FROM EVENTS WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    db.events = db.events.filter(e => Number(e.calendar_id) !== Number(calId));
    return;
  }

  if (normalized.startsWith('DELETE FROM CALENDARS WHERE ID = ?')) {
    const [id] = params;
    if (db.calendars) db.calendars = db.calendars.filter(c => Number(c.id) !== Number(id));
    return;
  }

  if (normalized.startsWith('UPDATE EVENTS SET DISPLAY_SIZE = ? WHERE ID = ?')) {
    const [display_size, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.display_size = clamp(Math.round(Number(display_size) || 52), 35, 420);
    return;
  }

  if (normalized.startsWith('UPDATE EVENTS SET USER_COLOUR = ? WHERE ID = ?')) {
    const [user_colour, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.user_colour = normalizeStoredItemColour(user_colour);
    return;
  }

  if (normalized.startsWith('UPDATE EVENTS SET DATE = ? WHERE ID = ?') && !normalized.includes('TITLE')) {
    const [date, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.date = date;
    return;
  }

  // New: update with is_all_day
  if (normalized.startsWith('UPDATE EVENTS SET DATE = ?, TITLE = ?, TIME = ?, IS_ALL_DAY = ?, NOTES = ?, USER_COLOUR = ?, DISPLAY_SIZE = ? WHERE ID = ?')) {
    const [date, title, time, is_all_day, notes, user_colour, display_size, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.date = date;
    target.title = title;
    target.time = time;
    target.is_all_day = Number(is_all_day) || 0;
    target.notes = notes;
    target.user_colour = user_colour;
    target.display_size = clamp(Math.round(Number(display_size) || 52), 35, 420);
    return;
  }

  // Legacy update without is_all_day (for undo/redo of pre-migration items)
  if (normalized.startsWith('UPDATE EVENTS SET DATE = ?, TITLE = ?, TIME = ?, NOTES = ?, USER_COLOUR = ?, DISPLAY_SIZE = ? WHERE ID = ?')) {
    const [date, title, time, notes, user_colour, display_size, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.date = date;
    target.title = title;
    target.time = time;
    target.notes = notes;
    target.user_colour = user_colour;
    target.display_size = clamp(Math.round(Number(display_size) || 52), 35, 420);
    return;
  }

  if (normalized.startsWith('UPDATE EVENTS SET DATE = ?, TITLE = ?, TIME = ?, NOTES = ?, USER_COLOUR = ? WHERE ID = ?')) {
    const [date, title, time, notes, user_colour, id] = params;
    const target = db.events.find((event) => Number(event.id) === Number(id));
    if (!target) return;
    target.date = date;
    target.title = title;
    target.time = time;
    target.notes = notes;
    target.user_colour = user_colour;
    return;
  }

  // New INSERT with is_all_day
  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TITLE, TIME, IS_ALL_DAY, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')) {
    const [date, title, time, is_all_day, notes, user_colour, display_size, calendar_id] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: Number(is_all_day) || 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: Number(calendar_id) || 0
    });
    return;
  }

  // New INSERT with is_all_day and explicit id (undo/redo re-insert)
  if (normalized.startsWith('INSERT INTO EVENTS(ID, DATE, TITLE, TIME, IS_ALL_DAY, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')) {
    const [id, date, title, time, is_all_day, notes, user_colour, display_size, calendar_id] = params;
    db.events.push({
      id: Number(id), date, title, time,
      is_all_day: Number(is_all_day) || 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: Number(calendar_id) || 0
    });
    db.nextEventId = Math.max(Number(db.nextEventId) || 1, Number(id) + 1);
    return;
  }

  // Legacy inserts (seed data, ICS import, SQL import — no is_all_day)
  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, IS_SEED, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')) {
    const [date, title, time, notes, user_colour, display_size, is_seed, calendar_id] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      is_seed: Number(is_seed) || 0,
      calendar_id: Number(calendar_id) || 0
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?)')) {
    const [date, title, time, notes, user_colour, display_size, calendar_id] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: Number(calendar_id) || 0
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE) VALUES(?, ?, ?, ?, ?, ?)')) {
    const [date, title, time, notes, user_colour, display_size] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: activeCalendarId || 0
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')) {
    const [id, date, title, time, notes, user_colour, display_size, calendar_id] = params;
    db.events.push({
      id: Number(id), date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: Number(calendar_id) || 0
    });
    db.nextEventId = Math.max(Number(db.nextEventId) || 1, Number(id) + 1);
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE) VALUES(?, ?, ?, ?, ?, ?, ?)')) {
    const [id, date, title, time, notes, user_colour, display_size] = params;
    db.events.push({
      id: Number(id), date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: activeCalendarId || 0
    });
    db.nextEventId = Math.max(Number(db.nextEventId) || 1, Number(id) + 1);
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TITLE, TIME, NOTES, USER_COLOUR) VALUES(?, ?, ?, ?, ?)')) {
    const [date, title, time, notes, user_colour] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: 52,
      calendar_id: activeCalendarId || 0
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TIME, TITLE, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID) VALUES(?, ?, ?, ?, ?, ?, ?)')) {
    const [date, time, title, notes, user_colour, display_size, calendar_id] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: clamp(Math.round(Number(display_size) || 52), 35, 420),
      calendar_id: Number(calendar_id) || 0
    });
    return;
  }

  if (normalized.startsWith('INSERT INTO EVENTS(DATE, TIME, TITLE, NOTES, USER_COLOUR) VALUES(?, ?, ?, ?, ?)')) {
    const [date, time, title, notes, user_colour] = params;
    db.events.push({
      id: db.nextEventId++,
      date, title, time,
      is_all_day: 0,
      notes, user_colour,
      display_size: 52,
      calendar_id: activeCalendarId || 0
    });
    return;
  }

  if (normalized.startsWith('ALTER TABLE CALENDARS ADD COLUMN SEED_INSTALLED')) {
    (db.calendars || []).forEach(c => { if (!('seed_installed' in c)) c.seed_installed = 0; });
    return;
  }

  if (normalized.startsWith('ALTER TABLE CALENDARS ADD COLUMN SEED_START')) {
    (db.calendars || []).forEach(c => { if (!('seed_start' in c)) c.seed_start = null; });
    return;
  }

  // ALTER TABLE calendars ADD COLUMN colour_N_hex / colour_N_name TEXT
  if (normalized.startsWith('ALTER TABLE CALENDARS ADD COLUMN COLOUR_')) {
    const colNameMatch = sql.match(/ADD COLUMN (\w+)/i);
    if (colNameMatch) {
      const col = colNameMatch[1].toLowerCase();
      (db.calendars || []).forEach(c => { if (!(col in c)) c[col] = null; });
    }
    return;
  }

  // UPDATE calendars SET colour_1_hex=?, colour_1_name=?, ... WHERE id=?
  if (normalized.startsWith('UPDATE CALENDARS SET COLOUR_1_HEX=?')) {
    const [c1h, c1n, c2h, c2n, c3h, c3n, c4h, c4n, c5h, c5n, c6h, c6n, c7h, c7n, c8h, c8n, id] = params;
    const cal = (db.calendars || []).find(c => Number(c.id) === Number(id));
    if (!cal) return;
    cal.colour_1_hex = c1h; cal.colour_1_name = c1n;
    cal.colour_2_hex = c2h; cal.colour_2_name = c2n;
    cal.colour_3_hex = c3h; cal.colour_3_name = c3n;
    cal.colour_4_hex = c4h; cal.colour_4_name = c4n;
    cal.colour_5_hex = c5h; cal.colour_5_name = c5n;
    cal.colour_6_hex = c6h; cal.colour_6_name = c6n;
    cal.colour_7_hex = c7h; cal.colour_7_name = c7n;
    cal.colour_8_hex = c8h; cal.colour_8_name = c8n;
    return;
  }

  if (normalized.startsWith('UPDATE CALENDARS SET SEED_INSTALLED = ?, SEED_START = ? WHERE ID = ?')) {
    const [seed_installed, seed_start, id] = params;
    const cal = (db.calendars || []).find(c => Number(c.id) === Number(id));
    if (!cal) return;
    cal.seed_installed = Number(seed_installed) || 0;
    cal.seed_start = seed_start || null;
    return;
  }

  if (normalized.startsWith('INSERT INTO DAY_VISIBILITY(CALENDAR_ID, DAY_OF_WEEK, VISIBILITY)')) {
    const [calId, dow, visibility] = params;
    if (!db.day_visibility) db.day_visibility = [];
    if (!db.nextDayVisibilityId) db.nextDayVisibilityId = 1;
    db.day_visibility.push({ id: db.nextDayVisibilityId++, calendar_id: Number(calId), date: null, day_of_week: Number(dow), visibility });
    return;
  }

  if (normalized.startsWith('INSERT INTO DAY_VISIBILITY(CALENDAR_ID, DATE, VISIBILITY)')) {
    const [calId, date, visibility] = params;
    if (!db.day_visibility) db.day_visibility = [];
    if (!db.nextDayVisibilityId) db.nextDayVisibilityId = 1;
    db.day_visibility.push({ id: db.nextDayVisibilityId++, calendar_id: Number(calId), date, day_of_week: null, visibility });
    return;
  }

  if (normalized.startsWith('DELETE FROM DAY_VISIBILITY WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    if (db.day_visibility) {
      db.day_visibility = db.day_visibility.filter(r => Number(r.calendar_id) !== Number(calId));
    }
    return;
  }
}

export function querySql(sql, params = []) {
  if (usingSqlRuntime) {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const shaped = {};
      columns.forEach((column, index) => { shaped[column] = row[index]; });
      return shaped;
    });
  }

  const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  if (normalized.startsWith('SELECT DATE, HEIGHT_PX FROM DAYS WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    const cid = Number(calId) || 0;
    return [...db.days]
      .filter(d => Number(d.calendar_id) === cid)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, height_px: d.height_px }));
  }

  if (normalized.startsWith('SELECT DATE, CALENDAR_ID, HEIGHT_PX FROM DAYS ORDER BY DATE ASC')) {
    return [...db.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, calendar_id: d.calendar_id, height_px: d.height_px }));
  }

  if (normalized === 'SELECT DATE, HEIGHT_PX FROM DAYS ORDER BY DATE ASC;') {
    return [...db.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, height_px: d.height_px }));
  }

  // Queries that include is_all_day
  if (normalized.startsWith('SELECT ID, DATE, TITLE, TIME, IS_ALL_DAY, NOTES, USER_COLOUR, DISPLAY_SIZE, IS_SEED, CALENDAR_ID FROM EVENTS WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    return [...db.events]
      .filter(e => Number(e.calendar_id) === Number(calId))
      .map((event) => ({
        ...event,
        is_all_day: Number(event.is_all_day) || 0,
        display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420)
      }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  // Legacy queries (for SQL import / older export files)
  if (normalized === 'SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE FROM EVENTS ORDER BY DATE ASC, TIME ASC, ID ASC;') {
    return [...db.events]
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized === 'SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, IS_SEED, CALENDAR_ID FROM EVENTS ORDER BY DATE ASC, TIME ASC, ID ASC;') {
    return [...db.events]
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized === 'SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID FROM EVENTS ORDER BY DATE ASC, TIME ASC, ID ASC;') {
    return [...db.events]
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized.startsWith('SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, IS_SEED, CALENDAR_ID FROM EVENTS WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    return [...db.events]
      .filter(e => Number(e.calendar_id) === Number(calId))
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized.startsWith('SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR, DISPLAY_SIZE, CALENDAR_ID FROM EVENTS WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    return [...db.events]
      .filter(e => Number(e.calendar_id) === Number(calId))
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized === 'SELECT ID, DATE, TITLE, TIME, NOTES, USER_COLOUR FROM EVENTS ORDER BY DATE ASC, TIME ASC, ID ASC;') {
    return [...db.events]
      .map((event) => ({ ...event, is_all_day: Number(event.is_all_day) || 0, display_size: clamp(Math.round(Number(event.display_size) || 52), 35, 420) }))
      .sort((a, b) => byItemDateTime(a, b) || Number(a.id) - Number(b.id));
  }

  if (normalized.startsWith('SELECT COUNT(*) AS COUNT FROM EVENTS WHERE DATE BETWEEN')) {
    const between = sql.match(/BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/i);
    if (!between) return [{ count: 0 }];
    const [, fromDate, toDate] = between;
    const count = db.events.filter((event) => event.date >= fromDate && event.date <= toDate).length;
    return [{ count }];
  }

  if (normalized.startsWith('SELECT ID, NAME, COLOUR_1_HEX')) {
    if (!db.calendars) db.calendars = [];
    return [...db.calendars].map(c => ({
      id: c.id, name: c.name,
      colour_1_hex:  c.colour_1_hex  ?? null, colour_1_name:  c.colour_1_name  ?? null,
      colour_2_hex:  c.colour_2_hex  ?? null, colour_2_name:  c.colour_2_name  ?? null,
      colour_3_hex:  c.colour_3_hex  ?? null, colour_3_name:  c.colour_3_name  ?? null,
      colour_4_hex:  c.colour_4_hex  ?? null, colour_4_name:  c.colour_4_name  ?? null,
      colour_5_hex:  c.colour_5_hex  ?? null, colour_5_name:  c.colour_5_name  ?? null,
      colour_6_hex:  c.colour_6_hex  ?? null, colour_6_name:  c.colour_6_name  ?? null,
      colour_7_hex:  c.colour_7_hex  ?? null, colour_7_name:  c.colour_7_name  ?? null,
      colour_8_hex:  c.colour_8_hex  ?? null, colour_8_name:  c.colour_8_name  ?? null,
      seed_installed: c.seed_installed ?? 0,  seed_start: c.seed_start ?? null
    }));
  }

  if (normalized.startsWith('SELECT ID, CALENDAR_ID, DATE, DAY_OF_WEEK, VISIBILITY FROM DAY_VISIBILITY WHERE CALENDAR_ID = ?') ||
      normalized.startsWith('SELECT CALENDAR_ID, DATE, DAY_OF_WEEK, VISIBILITY FROM DAY_VISIBILITY WHERE CALENDAR_ID = ?')) {
    const [calId] = params;
    if (!db.day_visibility) return [];
    return db.day_visibility
      .filter(r => Number(r.calendar_id) === Number(calId))
      .map(r => ({ id: r.id, calendar_id: r.calendar_id, date: r.date ?? null, day_of_week: r.day_of_week ?? null, visibility: r.visibility }));
  }

  if (normalized.startsWith('SELECT ID, NAME FROM CALENDARS')) {
    if (!db.calendars) db.calendars = [];
    return [...db.calendars].map(c => ({ id: c.id, name: c.name }));
  }

  if (normalized === 'SELECT ID FROM CALENDARS LIMIT 1;') {
    if (!db.calendars || !db.calendars.length) return [];
    return [{ id: db.calendars[0].id }];
  }

  return [];
}

/**
 * createSchema — sets up tables and runs all migrations in order.
 *
 * Migration order (sql.js runtime):
 * 1. days: migrate from old schema → days_v2 → rename → drop days_v2 if leftover
 * 2. days: add height_px column if missing
 * 3. events: add display_size, is_seed, calendar_id, is_all_day columns if missing
 * 4. calendars: create if missing
 * 5. Migrate orphaned rows to the default calendar
 */
export function createSchema() {
  if (usingSqlRuntime) {
    // ── Days table migration ──────────────────────────────────────────────
    try {
      db.exec('SELECT calendar_id FROM days LIMIT 0;');
      // Column already exists — migration already done.
    } catch {
      // Old schema without calendar_id: migrate via days_v2
      try {
        db.run('CREATE TABLE IF NOT EXISTS days_v2 (date TEXT NOT NULL, calendar_id INTEGER NOT NULL DEFAULT 0, height_px INTEGER NOT NULL DEFAULT 110, PRIMARY KEY(date, calendar_id));');
        db.run('INSERT OR IGNORE INTO days_v2(date, calendar_id, height_px) SELECT date, 0, MAX(110, MIN(1100, CAST(ROUND(COALESCE(height_multiplier, 1) * 110) AS INTEGER))) FROM days;');
        db.run('DROP TABLE days;');
        db.run('ALTER TABLE days_v2 RENAME TO days;');
      } catch (e) {
        console.warn('Days table migration failed:', e);
      }
    }

    // Drop days_v2 if it still exists (e.g. a previous partial migration)
    try {
      db.exec('SELECT 1 FROM days_v2 LIMIT 0;');
      // If we get here, the table exists but is no longer needed
      db.run('DROP TABLE days_v2;');
      console.info('DashCal: dropped stale days_v2 table.');
    } catch {
      // days_v2 does not exist — expected, nothing to do
    }

    // height_px column migration
    try {
      db.exec('SELECT height_px FROM days LIMIT 0;');
    } catch {
      try {
        db.run('ALTER TABLE days ADD COLUMN height_px INTEGER NOT NULL DEFAULT 110;');
        db.run('UPDATE days SET height_px = MAX(110, MIN(1100, CAST(ROUND(COALESCE(height_multiplier, 1) * 110) AS INTEGER)));');
      } catch (e) {
        console.warn('Days height_px migration failed:', e);
      }
    }

    // ── Events table migrations ───────────────────────────────────────────
    // is_all_day column: existing items without it get 0 (untimed, not all-day)
    try {
      db.exec('SELECT is_all_day FROM events LIMIT 0;');
    } catch {
      try {
        db.run('ALTER TABLE events ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;');
      } catch (e) {
        console.warn('Events is_all_day migration failed:', e);
      }
    }
  }

  // Create tables (no-ops if they already exist)
  runSql('CREATE TABLE IF NOT EXISTS days (date TEXT NOT NULL, calendar_id INTEGER NOT NULL DEFAULT 0, height_px INTEGER NOT NULL DEFAULT 110, PRIMARY KEY(date, calendar_id));');
  runSql("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT DEFAULT '', title TEXT NOT NULL, time TEXT, is_all_day INTEGER NOT NULL DEFAULT 0, notes TEXT, user_colour TEXT, display_size INTEGER NOT NULL DEFAULT 52, is_seed INTEGER NOT NULL DEFAULT 0, calendar_id INTEGER NOT NULL DEFAULT 0);");

  try { runSql('ALTER TABLE events ADD COLUMN display_size INTEGER NOT NULL DEFAULT 52;'); } catch {}
  try { runSql('ALTER TABLE events ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { runSql('ALTER TABLE events ADD COLUMN calendar_id INTEGER NOT NULL DEFAULT 0;'); } catch {}
  try { runSql('ALTER TABLE events ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;'); } catch {}

  runSql(
    'CREATE TABLE IF NOT EXISTS calendars (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ' +
    'colour_1_hex TEXT, colour_1_name TEXT, colour_2_hex TEXT, colour_2_name TEXT, ' +
    'colour_3_hex TEXT, colour_3_name TEXT, colour_4_hex TEXT, colour_4_name TEXT, ' +
    'colour_5_hex TEXT, colour_5_name TEXT, colour_6_hex TEXT, colour_6_name TEXT, ' +
    'colour_7_hex TEXT, colour_7_name TEXT, colour_8_hex TEXT, colour_8_name TEXT' +
    ');'
  );

  // Migrate existing databases: add colour columns if absent (safe to run on every boot)
  for (let i = 1; i <= 8; i++) {
    try { runSql(`ALTER TABLE calendars ADD COLUMN colour_${i}_hex TEXT;`); } catch {}
    try { runSql(`ALTER TABLE calendars ADD COLUMN colour_${i}_name TEXT;`); } catch {}
  }

  try { runSql('ALTER TABLE calendars ADD COLUMN seed_installed INTEGER DEFAULT 0;'); } catch {}
  try { runSql('ALTER TABLE calendars ADD COLUMN seed_start TEXT;'); } catch {}

  runSql(
    'CREATE TABLE IF NOT EXISTS day_visibility (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'calendar_id INTEGER NOT NULL,' +
    'date TEXT,' +
    'day_of_week INTEGER,' +
    'visibility TEXT NOT NULL CHECK(visibility IN (\'hidden\', \'shown\')),' +
    'FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE' +
    ');'
  );

  ensureDefaultCalendar();
  migrateOrphanedEvents();
  migrateOrphanedDays();
}

export function migrateOrphanedDays() {
  const cals = querySql('SELECT id FROM calendars ORDER BY id ASC LIMIT 1;');
  if (!cals.length) return;
  const defaultCalId = Number(cals[0].id);
  if (usingSqlRuntime) {
    db.run('UPDATE days SET calendar_id = ? WHERE calendar_id = 0;', [defaultCalId]);
  } else {
    (db.days || []).forEach(d => {
      if (!d.calendar_id || Number(d.calendar_id) === 0) d.calendar_id = defaultCalId;
    });
  }
  persistDb();
}

export function migrateOrphanedEvents() {
  const cals = querySql('SELECT id FROM calendars ORDER BY id ASC LIMIT 1;');
  if (!cals.length) return;
  const defaultCalId = Number(cals[0].id);
  if (usingSqlRuntime) {
    db.run('UPDATE events SET calendar_id = ? WHERE calendar_id = 0;', [defaultCalId]);
  } else {
    (db.events || []).forEach(e => {
      if (!e.calendar_id || Number(e.calendar_id) === 0) e.calendar_id = defaultCalId;
    });
  }
  persistDb();
}

export function bootstrapDays({ rangeStart, rangeEnd, activeCalendarId } = {}) {
  if (!(rangeStart instanceof Date) || Number.isNaN(rangeStart.getTime()) || !(rangeEnd instanceof Date) || Number.isNaN(rangeEnd.getTime())) {
    const today = new Date();
    rangeStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    rangeEnd = new Date(today.getFullYear(), today.getMonth() + 3, 0);
  }

  const calId = activeCalendarId ?? getActiveCalendarId();
  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const iso = toISODate(cursor);
    runSql('INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, 110) ON CONFLICT(date, calendar_id) DO NOTHING;', [iso, calId || 0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  persistDb();
}

// ─────────────────────────────────────────
// One-time localStorage → DB migration
// ─────────────────────────────────────────

/**
 * migrateLocalStorageToDB — runs once on app load.
 *
 * Moves legacy localStorage keys into the new DB schema:
 *   dashcal-working-week          → day_visibility rows (hidden day_of_week)
 *   dashcal-hidden-days           → day_visibility rows (hidden date)
 *   dashcal-shown-days            → day_visibility rows (shown date)
 *   dashcal-seed-installed-v2-cal-{id} → calendars.seed_installed
 *   dashcal-seed-start-v2-cal-{id}    → calendars.seed_start
 *
 * Legacy keys are deleted after migration. Existing users will not lose data.
 */
export function migrateLocalStorageToDB() {
  const WORKING_WEEK_LS_KEY = 'dashcal-working-week';
  const HIDDEN_DAYS_LS_KEY  = 'dashcal-hidden-days';
  const SHOWN_DAYS_LS_KEY   = 'dashcal-shown-days';

  let dirty = false;
  const calRows = querySql('SELECT id, name FROM calendars ORDER BY id ASC;');

  // ── Working week → day_visibility (days NOT in working week become hidden) ──
  const rawWeek = localStorage.getItem(WORKING_WEEK_LS_KEY);
  if (rawWeek !== null) {
    let workingWeekDays = [0, 1, 2, 3, 4, 5, 6];
    try {
      const parsed = JSON.parse(rawWeek);
      if (Array.isArray(parsed)) {
        workingWeekDays = parsed.filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
      }
    } catch {}
    if (!workingWeekDays.length) workingWeekDays = [0, 1, 2, 3, 4, 5, 6];

    const hiddenDOWs = [0, 1, 2, 3, 4, 5, 6].filter(d => !workingWeekDays.includes(d));
    for (const cal of calRows) {
      for (const dow of hiddenDOWs) {
        runSql(
          'INSERT INTO day_visibility(calendar_id, day_of_week, visibility) VALUES(?, ?, ?);',
          [cal.id, dow, 'hidden']
        );
      }
    }
    localStorage.removeItem(WORKING_WEEK_LS_KEY);
    dirty = true;
  }

  // ── Hidden specific dates → day_visibility ────────────────────────────────
  const rawHidden = localStorage.getItem(HIDDEN_DAYS_LS_KEY);
  if (rawHidden !== null) {
    try {
      const parsed = JSON.parse(rawHidden);
      if (Array.isArray(parsed)) {
        for (const cal of calRows) {
          for (const date of parsed) {
            if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
              runSql(
                'INSERT INTO day_visibility(calendar_id, date, visibility) VALUES(?, ?, ?);',
                [cal.id, date, 'hidden']
              );
            }
          }
        }
      }
    } catch {}
    localStorage.removeItem(HIDDEN_DAYS_LS_KEY);
    dirty = true;
  }

  // ── Shown specific dates → day_visibility ────────────────────────────────
  const rawShown = localStorage.getItem(SHOWN_DAYS_LS_KEY);
  if (rawShown !== null) {
    try {
      const parsed = JSON.parse(rawShown);
      if (Array.isArray(parsed)) {
        for (const cal of calRows) {
          for (const date of parsed) {
            if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
              runSql(
                'INSERT INTO day_visibility(calendar_id, date, visibility) VALUES(?, ?, ?);',
                [cal.id, date, 'shown']
              );
            }
          }
        }
      }
    } catch {}
    localStorage.removeItem(SHOWN_DAYS_LS_KEY);
    dirty = true;
  }

  // ── Per-calendar seed keys → calendars.seed_installed / seed_start ────────
  for (const cal of calRows) {
    const installedKey = `${SEED_INSTALLED_KEY}-cal-${cal.id}`;
    const startKey     = `${SEED_START_KEY}-cal-${cal.id}`;
    const seedInstalled = localStorage.getItem(installedKey);
    const seedStart     = localStorage.getItem(startKey);
    if (seedInstalled !== null || seedStart !== null) {
      runSql(
        'UPDATE calendars SET seed_installed = ?, seed_start = ? WHERE id = ?;',
        [seedInstalled === '1' ? 1 : 0, seedStart || null, cal.id]
      );
      localStorage.removeItem(installedKey);
      localStorage.removeItem(startKey);
      dirty = true;
    }
  }

  if (dirty) persistDb();
}
