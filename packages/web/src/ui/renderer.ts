/**
 * P2P Drop — Futuristic Radar Scanner UI
 * Canvas-based radar with scanning beam, proximity mapping, smart icons,
 * glassmorphism settings panel, particle background, and i18n (AR/EN).
 */

import type { DeviceIdentity, FileMetadata, ProgressUpdate, TransferState, TransferDirection } from '@p2p-drop/core';

/* ═══════════════════════════════════════
   TYPES
   ═══════════════════════════════════════ */
interface UICallbacks {
  onFilesSelected: (files: FileList | File[], peerId: string) => void;
  onPeerClick: (peerId: string) => void;
}

interface PeerEntry {
  id: string;
  device: DeviceIdentity;
  connected: boolean;
  /** Simulated signal strength 0‒1 (1 = strongest). */
  signal: number;
  /** Angle on radar in radians. */
  angle: number;
}

interface Settings {
  theme: 'dark' | 'light';
  language: 'en' | 'ar';
  storagePath: string;
  stealthMode: boolean;
}

/* ═══════════════════════════════════════
   I18N STRINGS
   ═══════════════════════════════════════ */
const i18n: Record<string, Record<string, string>> = {
  en: {
    title: 'Kareem 🚀⚡🚀 Hamza',
    subtitle: 'Secure peer-to-peer file transfer',
    scanning: 'Scanning',
    noDevices: 'Looking for nearby devices...',
    openHint: 'Open Kareem 🚀⚡🚀 Hamza in another tab or device',
    dropTitle: 'Drag & drop files here',
    dropHint: 'or click to select files',
    transfers: 'Transfers',
    pairing: 'Pairing',
    scanConnect: 'Scan to connect',
    shareLink: 'Share this link:',
    footer: 'Files are transferred directly between devices — no server involved',
    settings: 'Settings',
    theme: 'Theme',
    darkMode: 'Dark',
    lightMode: 'Light',
    language: 'Language',
    storagePath: 'Download Location',
    storageDesc: 'Files will be saved to your browser downloads',
    stealthMode: 'Stealth Mode',
    stealthDesc: 'Hide from radar — other devices won\'t see you',
    close: 'Close',
    selectPeer: 'Please select a device first',
    me: 'YOU',
    connected: 'Connected',
    available: 'Available',
    waiting: 'Waiting...',
    sent: 'Sent',
    received: 'Received',
    to: 'to',
    from: 'from',
    rejected: 'rejected the transfer',
  },
  ar: {
    title: 'Kareem 🚀⚡🚀 Hamza',
    subtitle: 'نقل الملفات الآمن من نظير إلى نظير',
    scanning: 'جاري المسح',
    noDevices: 'جاري البحث عن الأجهزة القريبة...',
    openHint: 'افتح Kareem 🚀⚡🚀 Hamza في تبويب أو جهاز آخر',
    dropTitle: 'اسحب وأفلت الملفات هنا',
    dropHint: 'أو انقر لاختيار الملفات',
    transfers: 'عمليات النقل',
    pairing: 'الاقتران',
    scanConnect: 'امسح للاتصال',
    shareLink: 'شارك هذا الرابط:',
    footer: 'يتم نقل الملفات مباشرة بين الأجهزة — بدون خادم',
    settings: 'الإعدادات',
    theme: 'المظهر',
    darkMode: 'داكن',
    lightMode: 'فاتح',
    language: 'اللغة',
    storagePath: 'مكان التحميل',
    storageDesc: 'سيتم حفظ الملفات في تنزيلات المتصفح',
    stealthMode: 'وضع التخفي',
    stealthDesc: 'الاختفاء من الرادار — الأجهزة الأخرى لن تراك',
    close: 'إغلاق',
    selectPeer: 'الرجاء اختيار جهاز أولاً',
    me: 'أنت',
    connected: 'متصل',
    available: 'متاح',
    waiting: 'انتظار...',
    sent: 'تم الإرسال',
    received: 'تم الاستلام',
    to: 'إلى',
    from: 'من',
    rejected: 'رفض النقل',
  },
};

/* ═══════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════ */
const deviceIcons: Record<string, string> = {
  'web': `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  'android': `<svg viewBox="0 0 24 24"><path d="M5 16V8a7 7 0 0 1 14 0v8"/><rect x="3" y="10" width="18" height="8" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><circle cx="8" cy="8" r=".5" fill="currentColor"/><circle cx="16" cy="8" r=".5" fill="currentColor"/></svg>`,
  'desktop-windows': `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
  'desktop-macos': `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
  'desktop-linux': `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
  'unknown': `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};

const ICON_SUN = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_GLOBE = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
const ICON_UPLOAD = `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const ICON_ARROW_UP = `<svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
const ICON_ARROW_DOWN = `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ICON_GHOST = `<svg viewBox="0 0 24 24"><path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`;
const ICON_DOWNLOAD_FOLDER = `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 17 15 14"/></svg>`;

/* ═══════════════════════════════════════
   STATE
   ═══════════════════════════════════════ */
let selectedPeerId: string | null = null;
let callbacks: UICallbacks;
let currentPeers: PeerEntry[] = [];
let radarAnimId: number | null = null;
let particleAnimId: number | null = null;
let beamAngle = 0;
let settings: Settings;

function t(key: string): string {
  return i18n[settings.language]?.[key] || i18n['en'][key] || key;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('p2p-drop-settings');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
    language: 'en',
    storagePath: '~/Downloads',
    stealthMode: false,
  };
}

function saveSettings(): void {
  localStorage.setItem('p2p-drop-settings', JSON.stringify(settings));
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', settings.theme);
}

function applyLanguage(): void {
  document.documentElement.setAttribute('dir', settings.language === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', settings.language);
}

/* ═══════════════════════════════════════
   RADAR CANVAS RENDERING
   ═══════════════════════════════════════ */
function drawRadar(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(cx, cy) - 2;

  // Get CSS custom properties for theme-aware colors
  const style = getComputedStyle(document.documentElement);
  const accentRaw = style.getPropertyValue('--accent').trim();
  const bgPrimary = style.getPropertyValue('--bg-primary').trim();

  ctx.clearRect(0, 0, w, h);

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.fillStyle = bgPrimary || '#050510';
  ctx.fill();

  // Grid rings
  const ringCount = 4;
  for (let i = 1; i <= ringCount; i++) {
    const r = (maxR / ringCount) * i;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(168, 85, 247, ${0.08 - i * 0.01})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Cross lines
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.05)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - maxR);
  ctx.lineTo(cx, cy + maxR);
  ctx.moveTo(cx - maxR, cy);
  ctx.lineTo(cx + maxR, cy);
  // Diagonal lines
  const diagOff = maxR * 0.707;
  ctx.moveTo(cx - diagOff, cy - diagOff);
  ctx.lineTo(cx + diagOff, cy + diagOff);
  ctx.moveTo(cx + diagOff, cy - diagOff);
  ctx.lineTo(cx - diagOff, cy + diagOff);
  ctx.stroke();

  // ─── Scanning beam ───
  beamAngle = (beamAngle + 0.012) % (Math.PI * 2);
  const beamLen = maxR;

  // Beam trail (gradient arc)
  const trailAngle = 0.6; // radians of trail
  const grad = ctx.createConicGradient(beamAngle - trailAngle, cx, cy);
  const normalizedStart = 0;
  const normalizedEnd = trailAngle / (Math.PI * 2);
  grad.addColorStop(normalizedStart, 'rgba(168, 85, 247, 0)');
  grad.addColorStop(normalizedEnd * 0.5, 'rgba(168, 85, 247, 0.05)');
  grad.addColorStop(normalizedEnd, 'rgba(168, 85, 247, 0.16)');
  grad.addColorStop(normalizedEnd + 0.001, 'rgba(168, 85, 247, 0)');
  grad.addColorStop(1, 'rgba(168, 85, 247, 0)');

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Beam line
  const bx = cx + Math.cos(beamAngle) * beamLen;
  const by = cy + Math.sin(beamAngle) * beamLen;

  const lineGrad = ctx.createLinearGradient(cx, cy, bx, by);
  lineGrad.addColorStop(0, 'rgba(168, 85, 247, 0.7)');
  lineGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = accentRaw || '#a855f7';
  ctx.fill();

  // Center glow
  const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
  centerGlow.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
  centerGlow.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.fillStyle = centerGlow;
  ctx.fill();

  // Outer glow
  const outerGlow = ctx.createRadialGradient(cx, cy, maxR - 15, cx, cy, maxR + 5);
  outerGlow.addColorStop(0, 'rgba(168, 85, 247, 0)');
  outerGlow.addColorStop(1, 'rgba(168, 85, 247, 0.08)');
  ctx.beginPath();
  ctx.arc(cx, cy, maxR + 5, 0, Math.PI * 2);
  ctx.fillStyle = outerGlow;
  ctx.fill();

  radarAnimId = requestAnimationFrame(() => drawRadar(canvas));
}

/* ═══════════════════════════════════════
   PARTICLE BACKGROUND
   ═══════════════════════════════════════ */
interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; opacity: number;
}

let particles: Particle[] = [];

function initParticles(canvas: HTMLCanvasElement): void {
  const count = 50;
  particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.3 + 0.1,
    });
  }
}

function drawParticles(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx.clearRect(0, 0, w, h);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(168, 85, 247, ${p.opacity})`;
    ctx.fill();
  }

  // Draw connections between close particles
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.07 * (1 - dist / 120)})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  particleAnimId = requestAnimationFrame(() => drawParticles(canvas));
}

/* ═══════════════════════════════════════
   DEVICE POSITIONING (Proximity Algorithm)
   ═══════════════════════════════════════ */
function getDeviceIcon(platform: string): string {
  return deviceIcons[platform] || deviceIcons['unknown'];
}

function computeSignalStrength(device: DeviceIdentity, connected: boolean): number {
  // Connected devices get strong signal
  if (connected) return 0.85 + Math.random() * 0.15;
  // Same platform = likely nearby
  const platformBonus = device.platform === 'web' ? 0.1 : 0;
  return 0.3 + Math.random() * 0.4 + platformBonus;
}

function positionOnRadar(signal: number, angle: number, wrapperSize: number): { x: number; y: number } {
  const center = wrapperSize / 2;
  const maxRadius = center - 30; // Leave margin for device icons
  // Strong signal = close to center, weak = near edge
  const distance = maxRadius * (1 - signal * 0.8);
  return {
    x: center + Math.cos(angle) * distance,
    y: center + Math.sin(angle) * distance,
  };
}

function getPulseSpeed(signal: number): string {
  // Stronger signal = faster pulse
  const speed = 2.5 - signal * 1.5; // 1.0s (strong) to 2.5s (weak)
  return `${speed.toFixed(1)}s`;
}

/* ═══════════════════════════════════════
   SETTINGS PANEL
   ═══════════════════════════════════════ */
function openSettings(): void {
  // Remove existing
  document.getElementById('settings-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'settings-overlay';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-panel">
      <h2>
        <span>${t('settings')}</span>
        <button class="close-btn" id="close-settings" aria-label="${t('close')}">&times;</button>
      </h2>

      <div class="setting-group">
        <label>${t('theme')}</label>
        <div class="setting-row">
          <span class="setting-label">${settings.theme === 'dark' ? ICON_MOON : ICON_SUN} ${settings.theme === 'dark' ? t('darkMode') : t('lightMode')}</span>
          <label class="toggle-switch">
            <input type="checkbox" id="theme-toggle-input" ${settings.theme === 'light' ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-group">
        <label>${t('language')}</label>
        <div class="segment-control">
          <button class="segment-btn ${settings.language === 'en' ? 'active' : ''}" data-lang="en">English</button>
          <button class="segment-btn ${settings.language === 'ar' ? 'active' : ''}" data-lang="ar">العربية</button>
        </div>
      </div>

      <div class="setting-group">
        <label>${t('storagePath')}</label>
        <input type="text" class="setting-input" id="storage-path-input" value="${escapeHtml(settings.storagePath)}" placeholder="~/Downloads" />
        <p class="setting-desc">${t('storageDesc')}</p>
      </div>

      <div class="setting-group">
        <label>${t('stealthMode')}</label>
        <div class="setting-row">
          <span class="setting-label">${ICON_GHOST} ${t('stealthMode')}</span>
          <label class="toggle-switch">
            <input type="checkbox" id="stealth-toggle-input" ${settings.stealthMode ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <p class="setting-desc">${t('stealthDesc')}</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettings();
  });

  // Close button
  document.getElementById('close-settings')!.addEventListener('click', closeSettings);

  // Theme toggle
  document.getElementById('theme-toggle-input')!.addEventListener('change', (e) => {
    settings.theme = (e.target as HTMLInputElement).checked ? 'light' : 'dark';
    applyTheme();
    saveSettings();
    // Re-open to update labels
    openSettings();
  });

  // Language buttons
  overlay.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.language = (btn as HTMLElement).dataset.lang as 'en' | 'ar';
      applyLanguage();
      saveSettings();
      // Rebuild entire UI
      closeSettings();
      rebuildUI();
      openSettings();
    });
  });

  // Storage path
  document.getElementById('storage-path-input')!.addEventListener('change', (e) => {
    settings.storagePath = (e.target as HTMLInputElement).value;
    saveSettings();
  });

  // Stealth toggle
  document.getElementById('stealth-toggle-input')!.addEventListener('change', (e) => {
    settings.stealthMode = (e.target as HTMLInputElement).checked;
    saveSettings();
  });
}

function closeSettings(): void {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.remove();
}

/* ═══════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════ */
let currentIdentity: DeviceIdentity;

function rebuildUI(): void {
  renderUI(currentIdentity, callbacks);
}

export function renderUI(identity: DeviceIdentity, cbs: UICallbacks): void {
  callbacks = cbs;
  currentIdentity = identity;
  settings = loadSettings();

  const app = document.getElementById('app');
  if (!app) return;

  applyTheme();
  applyLanguage();

  app.innerHTML = `
    <canvas id="particle-canvas"></canvas>
    <div class="container">
      <header>
        <h1>${t('title')}</h1>
        <p class="subtitle">${t('subtitle')}</p>
        <div class="header-row">
          <div class="device-info">
            <span class="device-icon">${getDeviceIcon(identity.platform)}</span>
            <span class="device-name">${escapeHtml(identity.deviceName)}</span>
          </div>
          <div class="header-actions">
            <button id="theme-toggle" class="icon-btn" title="${t('theme')}" aria-label="Toggle theme">
              ${settings.theme === 'dark' ? ICON_SUN : ICON_MOON}
            </button>
            <button id="settings-btn" class="icon-btn" title="${t('settings')}" aria-label="Settings">
              ${ICON_SETTINGS}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section class="radar-section">
          <div class="radar-wrapper" id="radar-wrapper">
            <canvas class="radar-canvas" id="radar-canvas"></canvas>
            <div class="radar-overlay"></div>
            <div class="radar-me">
              <div class="me-dot"></div>
              <div class="me-label">${t('me')}</div>
            </div>
            <div id="radar-devices"></div>
            <div id="radar-empty" class="radar-empty">
              <p>${t('noDevices')}</p>
              <p class="scan-label">${t('scanning')}...</p>
            </div>
          </div>
        </section>

        <section class="drop-zone-section">
          <input type="file" id="file-input" multiple style="display:none;position:absolute;left:-9999px" />
          <div id="drop-zone" class="drop-zone">
            <div class="drop-zone-content">
              <div class="drop-icon">${ICON_UPLOAD}</div>
              <p>${t('dropTitle')}</p>
              <p class="hint">${t('dropHint')}</p>
            </div>
          </div>
        </section>

        <section class="transfers-section" id="transfers-section" style="display:none">
          <h2>${t('transfers')}</h2>
          <div id="transfers-list" class="transfers-list"></div>
        </section>

        <section class="pairing-section">
          <h2>${t('pairing')}</h2>
          <div class="pairing-options">
            <div class="qr-container">
              <canvas id="qr-canvas" width="180" height="180"></canvas>
              <p class="hint">${t('scanConnect')}</p>
            </div>
            <div class="link-container">
              <p>${t('shareLink')}</p>
              <code id="pairing-url" class="pairing-link"></code>
            </div>
          </div>
        </section>
      </main>

      <footer>
        ${ICON_LOCK}
        <p>${t('footer')}</p>
      </footer>
    </div>

    <div id="notification-container" class="notification-container"></div>
  `;

  // Initialize radar canvas
  const radarCanvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
  if (radarCanvas) {
    if (radarAnimId) cancelAnimationFrame(radarAnimId);
    drawRadar(radarCanvas);
  }

  // Initialize particle background
  const particleCanvas = document.getElementById('particle-canvas') as HTMLCanvasElement;
  if (particleCanvas) {
    if (particleAnimId) cancelAnimationFrame(particleAnimId);
    initParticles(particleCanvas);
    drawParticles(particleCanvas);
  }

  // Theme toggle
  document.getElementById('theme-toggle')!.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveSettings();
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = settings.theme === 'dark' ? ICON_SUN : ICON_MOON;
  });

  // Settings button
  document.getElementById('settings-btn')!.addEventListener('click', openSettings);

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem('p2p-drop-settings')) {
      settings.theme = e.matches ? 'light' : 'dark';
      applyTheme();
    }
  });

  setupDropZone();
  setupFileInput();

  // Re-render any existing peers
  if (currentPeers.length > 0) {
    renderRadarDevices();
  }
}

/* ═══════════════════════════════════════
   PEER RENDERING ON RADAR
   ═══════════════════════════════════════ */
function renderRadarDevices(): void {
  const container = document.getElementById('radar-devices');
  const emptyState = document.getElementById('radar-empty');
  const wrapper = document.getElementById('radar-wrapper');
  if (!container || !wrapper) return;

  const wrapperSize = wrapper.getBoundingClientRect().width || 420;

  if (currentPeers.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = currentPeers.map(peer => {
    const pos = positionOnRadar(peer.signal, peer.angle, wrapperSize);
    const pulseSpeed = getPulseSpeed(peer.signal);
    const icon = getDeviceIcon(peer.device.platform);
    const isSelected = selectedPeerId === peer.id;
    const statusClass = peer.connected ? 'online' : 'connecting';
    const statusText = peer.connected ? t('connected') : t('available');
    const opacity = 0.5 + peer.signal * 0.5;

    return `
      <div class="radar-device device-enter ${isSelected ? 'selected' : ''}"
           data-peer-id="${escapeHtml(peer.id)}"
           style="left: ${pos.x}px; top: ${pos.y}px; --pulse-speed: ${pulseSpeed}; opacity: ${opacity};">
        <div class="device-dot">
          ${icon}
          <div class="pulse-ring"></div>
          <div class="pulse-ring-2"></div>
        </div>
        <div class="device-label">${escapeHtml(peer.device.deviceName)}</div>
        <div class="device-tooltip">
          <div class="tt-name">${escapeHtml(peer.device.deviceName)}</div>
          <div class="tt-platform">${escapeHtml(peer.device.platform)}</div>
          <div class="tt-status ${statusClass}">${statusText}</div>
        </div>
      </div>
    `;
  }).join('');

  // Attach click handlers
  container.querySelectorAll('.radar-device').forEach(el => {
    el.addEventListener('click', () => {
      const peerId = (el as HTMLElement).dataset.peerId!;
      selectedPeerId = peerId;
      callbacks.onPeerClick(peerId);

      // Update selection
      container.querySelectorAll('.radar-device').forEach(d => d.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

export function updatePeerList(peers: Array<{ id: string; device: DeviceIdentity; connected: boolean }>): void {
  // Assign signal strength and angles
  currentPeers = peers.map((peer, idx) => {
    const existing = currentPeers.find(p => p.id === peer.id);
    return {
      ...peer,
      signal: existing?.signal ?? computeSignalStrength(peer.device, peer.connected),
      angle: existing?.angle ?? ((Math.PI * 2 * idx) / Math.max(peers.length, 1) + Math.random() * 0.3),
    };
  });

  renderRadarDevices();
}

/* ═══════════════════════════════════════
   TRANSFERS
   ═══════════════════════════════════════ */
export function addTransferEntry(
  metadata: FileMetadata,
  direction: TransferDirection,
  peerName: string
): void {
  const section = document.getElementById('transfers-section');
  const list = document.getElementById('transfers-list');
  if (!section || !list) return;

  section.style.display = 'block';

  const entry = document.createElement('div');
  entry.className = 'transfer-entry';
  entry.id = `transfer-${metadata.fileId}`;
  entry.innerHTML = `
    <div class="transfer-header">
      <span class="transfer-direction ${direction}">${direction === 'send' ? ICON_ARROW_UP : ICON_ARROW_DOWN}</span>
      <span class="transfer-filename" title="${escapeHtml(metadata.fileName)}">${escapeHtml(metadata.fileName)}</span>
      <div class="transfer-meta">
        <span class="transfer-size">${formatSize(metadata.fileSize)}</span>
        <span class="separator"></span>
        <span class="transfer-peer">${direction === 'send' ? t('to') : t('from')} ${escapeHtml(peerName)}</span>
      </div>
    </div>
    <div class="transfer-progress">
      <div class="progress-bar">
        <div class="progress-fill" id="progress-${metadata.fileId}" style="width: 0%"></div>
      </div>
      <div class="transfer-stats">
        <span class="transfer-speed" id="speed-${metadata.fileId}">${t('waiting')}</span>
        <span class="transfer-eta" id="eta-${metadata.fileId}"></span>
        <span class="transfer-state state-pending" id="state-${metadata.fileId}">pending</span>
      </div>
    </div>
  `;

  list.prepend(entry);
}

export function updateTransferProgress(fileId: string, update: ProgressUpdate): void {
  const progressBar = document.getElementById(`progress-${fileId}`);
  const speedEl = document.getElementById(`speed-${fileId}`);
  const etaEl = document.getElementById(`eta-${fileId}`);

  if (progressBar) {
    const percent = (update.bytesTransferred / update.totalBytes) * 100;
    progressBar.style.width = `${percent.toFixed(1)}%`;
  }
  if (speedEl) {
    speedEl.textContent = `${formatSize(update.speed)}/s`;
  }
  if (etaEl) {
    etaEl.textContent = update.eta > 0 ? `ETA: ${formatTime(update.eta)}` : '';
  }
}

export function updateTransferState(fileId: string, state: TransferState): void {
  const stateEl = document.getElementById(`state-${fileId}`);
  const entry = document.getElementById(`transfer-${fileId}`);

  if (stateEl) {
    stateEl.textContent = state;
    stateEl.className = `transfer-state state-${state}`;
  }
  if (entry) {
    entry.className = `transfer-entry ${state}`;
  }
}

/* ═══════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════ */
export function showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  container.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('notification-exit');
    setTimeout(() => notification.remove(), 250);
  }, 4000);
}

/* ═══════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════ */
function setupDropZone(): void {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget as Node)) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = (e as DragEvent).dataTransfer?.files;
    if (files && files.length > 0) handleFilesSelected(files);
  });

  // Open file picker on click — input is outside the drop zone to prevent click bubbling loop
  dropZone.addEventListener('click', () => {
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    if (input) input.click();
  });
}

function setupFileInput(): void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  if (!input) return;

  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) {
      handleFilesSelected(input.files);
      input.value = '';
    }
  });
}

function handleFilesSelected(files: FileList): void {
  if (!selectedPeerId) {
    showNotification(t('selectPeer'), 'warning');
    return;
  }
  callbacks.onFilesSelected(files, selectedPeerId);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
