// statusbar.js — DashCal status bar module

import { initPwa } from './pwa.js';
import { openExportOptions } from './settings.js';

export const APP_VERSION = '1.0.8';

// ─── Internal constants ───────────────────────────────────────────────────────
const STATUS_DEFAULT_DURATION = 3000;
const STATUS_UPDATE_DURATION = 10000;
const LAST_EXPORT_KEY = 'dashcal-last-export';
export const LAST_SEEN_VERSION_KEY = 'dashcal-last-seen-version';

// ─── Internal state ───────────────────────────────────────────────────────────
let statusFadeTimer = null;

// ─────────────────────────────────────────
// Status Bar
// ─────────────────────────────────────────

export function showStatus(message, { duration = STATUS_DEFAULT_DURATION, link = null } = {}) {
  const el = document.getElementById('status-message');
  if (!el) return;

  // Cancel any in-progress fade
  if (statusFadeTimer) {
    clearTimeout(statusFadeTimer);
    statusFadeTimer = null;
  }

  // Clear previous content
  el.innerHTML = '';
  el.style.opacity = '1';

  if (link) {
    const text = document.createTextNode(message + ' ');
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.color = 'inherit';
    anchor.style.textDecoration = 'underline';
    anchor.style.opacity = '0.7';
    el.appendChild(text);
    el.appendChild(anchor);
  } else {
    el.textContent = message;
  }

  // Fade out after duration
  statusFadeTimer = setTimeout(() => {
    el.style.transition = 'opacity 0.6s ease';
    el.style.opacity = '0';
    statusFadeTimer = setTimeout(() => {
      el.textContent = '';
      el.style.transition = '';
      el.style.opacity = '1';
      statusFadeTimer = null;
    }, 600);
  }, duration);
}

export function initStatusBar() {
  // Version
  const statusVersion = document.getElementById('status-version');
  if (statusVersion) {
    statusVersion.textContent = `v${APP_VERSION}`;
  }

  // Export nudge
  renderExportNudge();

  // PWA install prompt and update detection
  initPwa();
}

export function renderExportNudge() {
  const statusExportNudge = document.getElementById('status-export-nudge');
  if (!statusExportNudge) return;
  const raw = localStorage.getItem(LAST_EXPORT_KEY);

  if (!raw) {
    statusExportNudge.textContent = 'Never exported';
    statusExportNudge.className = 'status-export-nudge nudge-warn';
    statusExportNudge.onclick = () => openExportOptions();
    return;
  }

  const lastDate = new Date(raw);
  const today = new Date();
  const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    statusExportNudge.textContent = 'Exported today';
    statusExportNudge.className = 'status-export-nudge nudge-ok';
    statusExportNudge.onclick = null;
  } else {
    statusExportNudge.textContent = `Exported ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    statusExportNudge.className = 'status-export-nudge nudge-warn';
    statusExportNudge.onclick = () => openExportOptions();
  }
}

export function recordExport() {
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
  renderExportNudge();
}
