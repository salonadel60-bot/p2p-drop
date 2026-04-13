/**
 * P2P Drop — Futuristic Radar Scanner UI
 * Canvas-based radar with scanning beam, proximity mapping, smart icons,
 * glassmorphism settings panel, particle background, and i18n (AR/EN).
 */

import jsQR from 'jsqr';
import type { DeviceIdentity, FileMetadata, ProgressUpdate, TransferState, TransferDirection } from '@p2p-drop/core';

/* ═══════════════════════════════════════
   TYPES
   ═══════════════════════════════════════ */
interface UICallbacks {
  onFilesSelected: (files: FileList | File[], peerId: string) => void;
  onPeerClick: (peerId: string) => void;
  onQRScanned: (data: string) => void;
  onStartMedia: (peerId: string, mode: 'voice' | 'video' | 'screen') => void;
  onStopMedia: (peerId: string) => void;
  onSendChat: (peerId: string, text: string) => void;
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
    dropTitle: 'Drop files here or tap to select',
    dropHint: 'Supports all file types · drag & drop or click',
    dropHintFiles: 'Add more files',
    transfers: 'Transfers',
    pairing: 'Pairing',
    scanConnect: 'Scan to connect',
    scanQR: 'Scan QR',
    scannerTitle: 'Scan pairing code',
    scannerHint: 'Point your camera at another device QR code',
    scannerStarting: 'Starting camera...',
    scannerCameraError: 'Camera access failed. Check browser permissions.',
    scannerFound: 'QR detected — connecting...',
    copied: 'Copied',
    mediaRoom: 'P2P Room',
    chat: 'Chat',
    chatPlaceholder: 'Write a message...',
    send: 'Send',
    chatHint: 'Select a radar device to start chatting',
    noMessages: 'No messages yet',
    voice: 'Voice',
    video: 'Video',
    screen: 'Screen',
    stopMedia: 'Stop',
    you: 'You',
    remotePeer: 'Remote',
    accept: 'Accept',
    reject: 'Reject',
    choosePeerMedia: 'Select a radar device to start voice, video, or screen sharing',
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
    selectPeer: 'Please select a device on the radar to send',
    me: 'YOU',
    connected: 'Connected',
    available: 'Available',
    waiting: 'Waiting...',
    sent: 'Sent',
    received: 'Received',
    to: 'to',
    from: 'from',
    rejected: 'rejected the transfer',
    filesReady: 'file(s) selected',
    readyToSend: 'Now tap a device on the radar to send',
    clearFiles: 'Clear',
    file: 'file',
    files: 'files',
    total: 'total',
  },
  ar: {
    title: 'Kareem 🚀⚡🚀 Hamza',
    subtitle: 'نقل الملفات الآمن من نظير إلى نظير',
    scanning: 'جاري المسح',
    noDevices: 'جاري البحث عن الأجهزة القريبة...',
    openHint: 'افتح Kareem 🚀⚡🚀 Hamza في تبويب أو جهاز آخر',
    dropTitle: 'اسحب الملفات هنا أو اضغط لاختيارها',
    dropHint: 'يدعم جميع أنواع الملفات · سحب وإفلات أو ضغط',
    dropHintFiles: 'إضافة المزيد من الملفات',
    transfers: 'عمليات النقل',
    pairing: 'الاقتران',
    scanConnect: 'امسح للاتصال',
    scanQR: 'Scan QR',
    scannerTitle: 'مسح رمز الاقتران',
    scannerHint: 'وجّه الكاميرا نحو رمز QR في الجهاز الآخر',
    scannerStarting: 'جاري تشغيل الكاميرا...',
    scannerCameraError: 'تعذر فتح الكاميرا. تحقق من صلاحيات المتصفح.',
    scannerFound: 'تم العثور على الرمز — جاري الاتصال...',
    copied: 'تم النسخ',
    mediaRoom: 'غرفة P2P',
    chat: 'الشات',
    chatPlaceholder: 'اكتب رسالة...',
    send: 'إرسال',
    chatHint: 'اختر جهازاً من الرادار لبدء المحادثة',
    noMessages: 'لا توجد رسائل بعد',
    voice: 'صوت',
    video: 'فيديو',
    screen: 'الشاشة',
    stopMedia: 'إيقاف',
    you: 'أنت',
    remotePeer: 'الطرف الآخر',
    accept: 'قبول',
    reject: 'رفض',
    choosePeerMedia: 'اختر جهازاً من الرادار لبدء الصوت أو الفيديو أو مشاركة الشاشة',
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
    selectPeer: 'اختر جهازاً على الرادار لإرسال الملفات',
    me: 'أنت',
    connected: 'متصل',
    available: 'متاح',
    waiting: 'انتظار...',
    sent: 'تم الإرسال',
    received: 'تم الاستلام',
    to: 'إلى',
    from: 'من',
    rejected: 'رفض النقل',
    filesReady: 'ملف/ملفات محددة',
    readyToSend: 'اضغط على جهاز في الرادار لإرسال الملفات',
    clearFiles: 'مسح',
    file: 'ملف',
    files: 'ملفات',
    total: 'إجمالي',
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
const ICON_CHECK_CIRCLE = `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const ICON_QR = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2v2h-4v-2"/></svg>`;

/* ═══════════════════════════════════════
   STATE
   ═══════════════════════════════════════ */
let selectedPeerId: string | null = null;
let pendingFiles: File[] = [];
let callbacks: UICallbacks;
let currentPeers: PeerEntry[] = [];
let radarAnimId: number | null = null;
let particleAnimId: number | null = null;
let scannerAnimId: number | null = null;
let scannerStream: MediaStream | null = null;
let beamAngle = 0;
let settings: Settings;
let mediaActive = false;
let chatMessages: Array<{ peerId: string; text: string; direction: 'sent' | 'received'; senderName: string; timestamp: number }> = [];

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

async function openQRScanner(): Promise<void> {
  closeQRScanner();

  const overlay = document.createElement('div');
  overlay.id = 'scanner-overlay';
  overlay.className = 'scanner-overlay';
  overlay.innerHTML = `
    <div class="scanner-panel">
      <div class="scanner-header">
        <div>
          <h2>${t('scannerTitle')}</h2>
          <p>${t('scannerHint')}</p>
        </div>
        <button class="close-btn" id="close-scanner" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="scanner-viewport">
        <video id="scanner-video" playsinline muted></video>
        <canvas id="scanner-canvas"></canvas>
        <div class="scanner-frame">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="scanner-line"></div>
      </div>
      <p class="scanner-status" id="scanner-status">${t('scannerStarting')}</p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('close-scanner')?.addEventListener('click', closeQRScanner);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeQRScanner();
  });

  const video = document.getElementById('scanner-video') as HTMLVideoElement | null;
  const canvas = document.getElementById('scanner-canvas') as HTMLCanvasElement | null;
  const status = document.getElementById('scanner-status');
  if (!video || !canvas || !navigator.mediaDevices?.getUserMedia) {
    status!.textContent = t('scannerCameraError');
    return;
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = scannerStream;
    await video.play();
    scanQRCodeFrame(video, canvas);
  } catch {
    if (status) status.textContent = t('scannerCameraError');
    showNotification(t('scannerCameraError'), 'error');
  }
}

function scanQRCodeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const status = document.getElementById('scanner-status');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const scan = () => {
    if (!document.getElementById('scanner-overlay')) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code?.data) {
        if (status) status.textContent = t('scannerFound');
        showNotification(t('scannerFound'), 'success');
        const scannedData = code.data;
        closeQRScanner();
        callbacks.onQRScanned(scannedData);
        return;
      }
    }

    scannerAnimId = requestAnimationFrame(scan);
  };

  scan();
}

function closeQRScanner(): void {
  if (scannerAnimId) {
    cancelAnimationFrame(scannerAnimId);
    scannerAnimId = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  document.getElementById('scanner-overlay')?.remove();
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
            <button id="pairing-modal-btn" class="icon-btn" title="${t('pairing')}" aria-label="${t('pairing')}">
              ${ICON_QR}
            </button>
            <button id="settings-btn" class="icon-btn" title="${t('settings')}" aria-label="Settings">
              ${ICON_SETTINGS}
            </button>
          </div>
        </div>
      </header>

      <main>
        <div class="experience-grid">
        <section class="radar-section smart-card">
          <div class="section-heading">
            <h2>${t('scanning')}</h2>
            <span id="radar-count">${currentPeers.length} online</span>
          </div>
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

        <div class="workspace-column">
        <section class="drop-zone-section smart-card">
          <div class="section-heading">
            <h2>${t('dropTitle')}</h2>
            <span>${t('dropHint')}</span>
          </div>
          <input type="file" id="file-input" multiple style="display:none;position:absolute;left:-9999px" />
          <div id="drop-zone" class="drop-zone">
            <div class="drop-zone-content">
              <div class="drop-icon">${ICON_UPLOAD}</div>
              <p>${t('dropTitle')}</p>
              <p class="hint">${t('dropHint')}</p>
            </div>
          </div>
        </section>

          <section class="chat-section smart-card">
            <div class="section-heading">
              <h2>${t('chat')}</h2>
              <span id="chat-peer-label">${t('chatHint')}</span>
            </div>
            <div class="chat-messages" id="chat-messages">
              <div class="chat-empty">${t('noMessages')}</div>
            </div>
            <form class="chat-composer" id="chat-form">
              <input id="chat-input" type="text" maxlength="800" placeholder="${t('chatPlaceholder')}" disabled />
              <button id="chat-send-btn" type="submit" disabled>${t('send')}</button>
            </form>
          </section>

        <section class="media-section smart-card">
          <div class="section-heading">
            <h2>${t('mediaRoom')}</h2>
            <span id="media-peer-label">${t('choosePeerMedia')}</span>
          </div>
          <div class="media-controls">
            <button class="media-btn" data-media-mode="voice" disabled>${t('voice')}</button>
            <button class="media-btn" data-media-mode="video" disabled>${t('video')}</button>
            <button class="media-btn" data-media-mode="screen" disabled>${t('screen')}</button>
            <button class="media-btn media-stop" id="media-stop-btn" style="display:none" disabled>${t('stopMedia')}</button>
          </div>
          <p class="media-hint" id="media-hint">${t('choosePeerMedia')}</p>
          <div class="media-room" id="media-room" style="display:none">
            <div class="media-tile remote-tile">
              <span>${t('remotePeer')}</span>
              <video id="remote-media" autoplay playsinline></video>
            </div>
            <div class="media-tile local-tile">
              <span>${t('you')}</span>
              <video id="local-media" autoplay playsinline muted></video>
            </div>
            <p id="media-label"></p>
          </div>
        </section>
        </div>
        </div>

        <section class="transfers-section smart-card" id="transfers-section" style="display:none">
          <h2>${t('transfers')}</h2>
          <div id="transfers-list" class="transfers-list"></div>
        </section>

      </main>

      <footer>
        ${ICON_LOCK}
        <p>${t('footer')}</p>
      </footer>
    </div>

    <div id="notification-container" class="notification-container"></div>
    <div id="pairing-overlay" class="pairing-overlay" style="display:none">
      <div class="pairing-panel">
        <div class="pairing-panel-header">
          <div>
            <h2>${t('pairing')}</h2>
            <p>${t('scanConnect')}</p>
          </div>
          <button class="close-btn" id="close-pairing" aria-label="${t('close')}">&times;</button>
        </div>
        <div class="pairing-stack">
          <div class="qr-container">
            <canvas id="qr-canvas" width="180" height="180"></canvas>
          </div>
          <div class="link-container">
            <p>${t('shareLink')}</p>
            <code id="pairing-url" class="pairing-link"></code>
          </div>
          <button id="scan-qr-btn" class="scan-qr-btn" type="button">
            ${ICON_QR}
            <span>${t('scanQR')}</span>
          </button>
        </div>
      </div>
    </div>
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

  const pairingOverlay = document.getElementById('pairing-overlay');
  document.getElementById('pairing-modal-btn')?.addEventListener('click', () => {
    if (pairingOverlay) pairingOverlay.style.display = 'flex';
  });
  document.getElementById('close-pairing')?.addEventListener('click', () => {
    if (pairingOverlay) pairingOverlay.style.display = 'none';
  });
  pairingOverlay?.addEventListener('click', (event) => {
    if (event.target === pairingOverlay) pairingOverlay.style.display = 'none';
  });

  document.getElementById('scan-qr-btn')?.addEventListener('click', () => {
    if (pairingOverlay) pairingOverlay.style.display = 'none';
    void openQRScanner();
  });

  document.getElementById('pairing-url')?.addEventListener('click', async (event) => {
    const element = event.currentTarget as HTMLElement;
    const text = element.dataset.fullUrl ?? element.textContent ?? '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showNotification(t('copied'), 'success');
  });

  document.querySelectorAll('.media-btn[data-media-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedPeerId) return;
      const mode = (btn as HTMLElement).dataset.mediaMode as 'voice' | 'video' | 'screen';
      callbacks.onStartMedia(selectedPeerId, mode);
    });
  });

  document.getElementById('media-stop-btn')?.addEventListener('click', () => {
    if (selectedPeerId) callbacks.onStopMedia(selectedPeerId);
  });

  document.getElementById('chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    const text = input?.value.trim() ?? '';
    if (!selectedPeerId || !text) return;
    callbacks.onSendChat(selectedPeerId, text);
    addChatMessage(selectedPeerId, text, 'sent', currentIdentity.deviceName);
    if (input) input.value = '';
  });

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
      updateMediaButtons();

      // Update selection visuals
      container.querySelectorAll('.radar-device').forEach(d => d.classList.remove('selected'));
      el.classList.add('selected');

      // If files are pending, send them now
      if (pendingFiles.length > 0) {
        callbacks.onFilesSelected([...pendingFiles], peerId);
        pendingFiles = [];
        setTimeout(renderDropZoneContent, 300);
      } else {
        callbacks.onPeerClick(peerId);
      }
      renderChatMessages();
    });
  });
}

function updateMediaButtons(): void {
  const enabled = Boolean(selectedPeerId);
  document.querySelectorAll<HTMLButtonElement>('.media-btn[data-media-mode]').forEach(btn => {
    btn.disabled = !enabled;
  });
  const stopBtn = document.getElementById('media-stop-btn') as HTMLButtonElement | null;
  if (stopBtn) {
    stopBtn.style.display = mediaActive ? 'inline-flex' : 'none';
    stopBtn.disabled = !mediaActive;
  }
  const chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
  const chatButton = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
  const selectedPeer = currentPeers.find(peer => peer.id === selectedPeerId);
  const chatPeerLabel = document.getElementById('chat-peer-label');
  const mediaPeerLabel = document.getElementById('media-peer-label');
  if (chatInput) chatInput.disabled = !enabled;
  if (chatButton) chatButton.disabled = !enabled;
  if (chatPeerLabel) chatPeerLabel.textContent = selectedPeer ? selectedPeer.device.deviceName : t('chatHint');
  if (mediaPeerLabel) mediaPeerLabel.textContent = selectedPeer ? selectedPeer.device.deviceName : t('choosePeerMedia');
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
  const radarCount = document.getElementById('radar-count');
  if (radarCount) radarCount.textContent = `${currentPeers.length} online`;
  updateMediaButtons();
  renderChatMessages();
}

export function addChatMessage(peerId: string, text: string, direction: 'sent' | 'received', senderName: string): void {
  chatMessages.push({ peerId, text, direction, senderName, timestamp: Date.now() });
  if (chatMessages.length > 250) chatMessages = chatMessages.slice(-250);
  if (!selectedPeerId && direction === 'received') {
    selectedPeerId = peerId;
    renderRadarDevices();
  }
  renderChatMessages();
}

function renderChatMessages(): void {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const visibleMessages = selectedPeerId
    ? chatMessages.filter(message => message.peerId === selectedPeerId)
    : [];

  if (visibleMessages.length === 0) {
    container.innerHTML = `<div class="chat-empty">${selectedPeerId ? t('noMessages') : t('chatHint')}</div>`;
    updateMediaButtons();
    return;
  }

  container.innerHTML = visibleMessages.map(message => `
    <div class="chat-bubble ${message.direction}">
      <div>${escapeHtml(message.text)}</div>
      <span>${escapeHtml(message.senderName)} · ${new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
  updateMediaButtons();
}

export function updateMediaRoom(
  localStream: MediaStream | null,
  remoteStream: MediaStream | null,
  mode: 'voice' | 'video' | 'screen' | null,
  peerName: string,
  peerId?: string
): void {
  const room = document.getElementById('media-room');
  const localVideo = document.getElementById('local-media') as HTMLVideoElement | null;
  const remoteVideo = document.getElementById('remote-media') as HTMLVideoElement | null;
  const label = document.getElementById('media-label');
  if (!room || !localVideo || !remoteVideo || !label) return;

  if (peerId) {
    selectedPeerId = peerId;
    renderRadarDevices();
  }

  localVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
  mediaActive = Boolean(localStream || remoteStream);
  room.style.display = mediaActive ? 'grid' : 'none';
  label.textContent = mode ? `${mode.toUpperCase()} · ${peerName}` : '';
  updateMediaButtons();
}

export function setPairingLink(fullURL: string, visibleURL: string): void {
  const pairingElement = document.getElementById('pairing-url');
  if (!pairingElement) return;
  pairingElement.textContent = visibleURL;
  pairingElement.dataset.fullUrl = fullURL;
  pairingElement.title = fullURL;
}

export function showActionRequest(
  title: string,
  message: string,
  acceptText = t('accept'),
  rejectText = t('reject')
): Promise<boolean> {
  document.getElementById('request-overlay')?.remove();
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'request-overlay';
    overlay.className = 'request-overlay';
    overlay.innerHTML = `
      <div class="request-panel">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="request-actions">
          <button class="request-btn reject" id="request-reject">${escapeHtml(rejectText)}</button>
          <button class="request-btn accept" id="request-accept">${escapeHtml(acceptText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const finish = (accepted: boolean) => {
      overlay.remove();
      resolve(accepted);
    };
    document.getElementById('request-accept')?.addEventListener('click', () => finish(true));
    document.getElementById('request-reject')?.addEventListener('click', () => finish(false));
  });
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

/* ═══════════════════════════════════════
   PENDING FILES — queue files before peer is selected
   ═══════════════════════════════════════ */

function getFileTypeIcon(file: File): string {
  const mime = file.type;
  if (mime.startsWith('image/')) return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  if (mime.startsWith('video/')) return `<svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
  if (mime.startsWith('audio/')) return `<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  if (mime === 'application/pdf') return `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('archive')) return `<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
  return ICON_FILE;
}

function renderDropZoneContent(): void {
  const content = document.querySelector('.drop-zone-content') as HTMLElement | null;
  const dropZone = document.getElementById('drop-zone');
  if (!content) return;

  if (pendingFiles.length === 0) {
    dropZone?.classList.remove('has-files');
    content.innerHTML = `
      <div class="drop-icon">${ICON_UPLOAD}</div>
      <p>${t('dropTitle')}</p>
      <p class="hint">${t('dropHint')}</p>
    `;
  } else {
    dropZone?.classList.add('has-files');
    const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);
    const countLabel = `${pendingFiles.length} ${pendingFiles.length === 1 ? t('file') : t('files')}`;
    const maxShow = 4;
    const shown = pendingFiles.slice(0, maxShow);
    const rest = pendingFiles.length - maxShow;

    const fileItems = shown.map(f => `
      <div class="pending-file-item">
        <span class="pending-file-icon">${getFileTypeIcon(f)}</span>
        <span class="pending-file-name">${escapeHtml(f.name)}</span>
        <span class="pending-file-size">${formatSize(f.size)}</span>
      </div>
    `).join('');

    const moreRow = rest > 0
      ? `<div class="pending-more">+${rest} ${t('files')}</div>`
      : '';

    const statusLine = selectedPeerId
      ? `<p class="pending-status-sending">⚡ ${t('readyToSend')}</p>`
      : `<p class="pending-status">${t('readyToSend')}</p>`;

    content.innerHTML = `
      <div class="pending-header">
        <div class="pending-check">${ICON_CHECK_CIRCLE}</div>
        <div class="pending-summary">
          <strong>${countLabel}</strong>
          <span class="pending-total">${formatSize(totalSize)} ${t('total')}</span>
        </div>
        <div class="pending-actions">
          <button class="pending-add-btn" id="pending-add-btn" title="${t('dropHintFiles')}">${ICON_PLUS}</button>
          <button class="pending-clear-btn" id="pending-clear-btn" title="${t('clearFiles')}">${ICON_X}</button>
        </div>
      </div>
      <div class="pending-file-list">${fileItems}${moreRow}</div>
      ${statusLine}
    `;

    // Add more files
    document.getElementById('pending-add-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.getElementById('file-input') as HTMLInputElement | null;
      if (input) input.click();
    });

    // Clear all files
    document.getElementById('pending-clear-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingFiles = [];
      renderDropZoneContent();
    });
  }
}

function handleFilesSelected(files: FileList | File[]): void {
  const arr = Array.from(files);
  if (arr.length === 0) return;

  // Accumulate — add new files to pending (avoid exact duplicates by name+size)
  for (const f of arr) {
    const isDup = pendingFiles.some(p => p.name === f.name && p.size === f.size);
    if (!isDup) pendingFiles.push(f);
  }

  // Always show the files visually first
  renderDropZoneContent();

  // If a peer is already selected, send immediately
  if (selectedPeerId && pendingFiles.length > 0) {
    callbacks.onFilesSelected([...pendingFiles], selectedPeerId);
    pendingFiles = [];
    setTimeout(renderDropZoneContent, 300);
  }
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
