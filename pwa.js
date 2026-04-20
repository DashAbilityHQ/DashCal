// pwa.js — DashCal PWA install prompt and update detection

import { LAST_SEEN_VERSION_KEY, APP_VERSION, showStatus } from './statusbar.js';

const STATUS_UPDATE_DURATION = 10000;

export function initPwa() {
  // Update detection
  checkForUpdate();

  // PWA install prompt
  let deferredInstallPrompt = null;
  const statusInstall = document.getElementById('status-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (statusInstall) {
      statusInstall.classList.remove('hidden');
      statusInstall.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          statusInstall.classList.add('hidden');
          deferredInstallPrompt = null;
        }
      }, { once: true });
    }
  });

  window.addEventListener('appinstalled', () => {
    if (statusInstall) statusInstall.classList.add('hidden');
    deferredInstallPrompt = null;
  });
}

function checkForUpdate() {
  const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);

  if (lastSeen && lastSeen !== APP_VERSION) {
    // A new version has loaded for the first time
    showStatus(
      `Updated to v${APP_VERSION} —`,
      {
        duration: STATUS_UPDATE_DURATION,
        link: {
          href: 'https://dashable.co.uk/dashcal/changelog',
          label: 'what changed?'
        }
      }
    );
  }

  // Record current version as seen
  localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION);
}
