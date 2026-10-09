export type IconName =
  | 'owned'
  | 'seeking'
  | 'ordered'
  | 'unowned'
  | 'hourglass'
  | 'gamepad'
  | 'play'
  | 'list-queued'
  | 'pause'
  | 'stop-circle'
  | 'verified-badge'
  | 'physical-box'
  | 'disc'
  | 'book-open'
  | 'ticket'
  | 'link'
  | 'rom-archive'
  | 'missing-dump'
  | 'flame'
  | 'zap'
  | 'coins'
  | 'tag'
  | 'shopping-cart'
  | 'storefront'
  | 'close'
  | 'bell'
  | 'lock'
  | 'unlock'
  | 'check'
  | 'alert-triangle'
  | 'ban'
  | 'inbox-empty'
  | 'compass'
  | 'sparkles'
  | 'refresh'
  | 'square-stop'
  | 'figure-toy'
  | 'sun'
  | 'moon'
  | 'sun-moon'
  | 'circle-fill'
  | 'circle-half'
  | 'circle-empty';

export interface IconDef {
  viewBox: string;
  svgInner: string;
}

export const ICON_CATALOG: Record<IconName, IconDef> = {
  owned: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.5 12 2.5 2.5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  seeking: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16.5 16.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  ordered: {
    viewBox: '0 0 24 24',
    svgInner: `<polygon points="12,2.5 20.5,7.5 12,12.5 3.5,7.5" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polygon points="3.5,7.5 12,12.5 12,21.5 3.5,16.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polygon points="12,12.5 20.5,7.5 20.5,16.5 12,21.5" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.75 5 L16.25 10 L16.25 13.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><polygon points="5 11 9 13.3 9 16.5 5 14.2" fill="currentColor" fill-opacity="0.45"/><line x1="6" y1="12.3" x2="8" y2="13.4" stroke="currentColor" stroke-width="1"/>`,
  },
  unowned: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>`,
  },
  hourglass: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M5 2h14v2a4 4 0 0 1-2 3.46L13.5 10a2 2 0 0 0 0 4l3.5 2.54A4 4 0 0 1 19 20v2H5v-2a4 4 0 0 1 2-3.46L10.5 14a2 2 0 0 0 0-4L7 7.46A4 4 0 0 1 5 4V2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 20 Q12 15 17 20 Z" fill="currentColor"/>`,
  },
  gamepad: {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="2" y="6" width="20" height="12" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="10" x2="8" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15.5" cy="13" r="1" fill="currentColor"/><circle cx="18" cy="11" r="1" fill="currentColor"/>`,
  },
  play: {
    viewBox: '0 0 24 24',
    svgInner: `<polygon points="7 4 19 12 7 20 7 4" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  },
  'list-queued': {
    viewBox: '0 0 24 24',
    svgInner: `<line x1="3" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="12" x2="13" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="11" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polygon points="17 14 22 17 17 20" fill="currentColor"/>`,
  },
  pause: {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>`,
  },
  'stop-circle': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor"/>`,
  },
  'verified-badge': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="9.5 8.5 11.5 10.5 14.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 13.5L6 21.5l4-2 2 2v-7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 13.5l2.5 8-4-2-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  'physical-box': {
    viewBox: '0 0 24 24',
    svgInner: `<polygon points="3,6 7,7.5 7,20.5 3,19" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polygon points="7,7.5 20,4.5 20,17.5 7,20.5" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polygon points="3,6 16,3 20,4.5 7,7.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><polygon points="8,8.2 19,5.7 19,8.5 8,11" fill="currentColor" fill-opacity="0.35"/>`,
  },
  disc: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M6.5 12a5.5 5.5 0 0 1 5.5-5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/><path d="M17.5 12a5.5 5.5 0 0 1-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>`,
  },
  'book-open': {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="3" y="4" width="8.5" height="16" rx="1" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><rect x="12.5" y="4" width="8.5" height="16" rx="1" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="11" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="2"/><line x1="11" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="2"/><line x1="5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="11" x2="9.5" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="14" x2="9.5" y2="14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="14.5" y1="8" x2="19" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="14.5" y1="11" x2="19" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="14.5" y1="14" x2="19" y2="14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  },
  ticket: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="6" x2="12" y2="8" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1 1"/><line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1 1"/><line x1="12" y1="16" x2="12" y2="18" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1 1"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/>`,
  },
  link: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  'rom-archive': {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M5 4 C5 3 6 2 7 2 H17 C18 2 19 3 19 4 V20 C19 21.1 18.1 22 17 22 H7 C5.9 22 5 21.1 5 20 Z" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="8" y1="4.5" x2="16" y2="4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="9.5" width="10" height="7" rx="1" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="7.5" y="19" width="9" height="3" fill="currentColor" fill-opacity="0.4"/><line x1="9.5" y1="19.5" x2="9.5" y2="21.5" stroke="currentColor" stroke-width="1"/><line x1="11.5" y1="19.5" x2="11.5" y2="21.5" stroke="currentColor" stroke-width="1"/><line x1="12.5" y1="19.5" x2="12.5" y2="21.5" stroke="currentColor" stroke-width="1"/><line x1="14.5" y1="19.5" x2="14.5" y2="21.5" stroke="currentColor" stroke-width="1"/>`,
  },
  'missing-dump': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="8" y1="8" x2="16" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="8" x2="8" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  flame: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 18c-1.1 0-2-.9-2-2 0-1.5 2-3.5 2-3.5s2 2 2 3.5c0 1.1-.9 2-2 2z" fill="currentColor"/>`,
  },
  zap: {
    viewBox: '0 0 24 24',
    svgInner: `<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  coins: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5"/><path d="M14 10 C13 9 10.5 9 9.5 10.5 C8.5 12 8.5 13.5 9.5 15 C10.5 16.5 13 16.5 14 15.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="11.5" y1="7.5" x2="11.5" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  tag: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M12 2H4a2 2 0 0 0-2 2v8l10 10 8-8L12 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/>`,
  },
  'shopping-cart': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="9" cy="20" r="1.5" fill="currentColor"/><circle cx="18" cy="20" r="1.5" fill="currentColor"/><path d="M2 3h3l2.5 11h11.5l2-8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  storefront: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M3 9l2-5h14l2 5v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 13v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="15" width="6" height="7" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  },
  close: {
    viewBox: '0 0 24 24',
    svgInner: `<line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  bell: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  lock: {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/>`,
  },
  unlock: {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/>`,
  },
  check: {
    viewBox: '0 0 24 24',
    svgInner: `<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  'alert-triangle': {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/>`,
  },
  ban: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" stroke-width="2"/>`,
  },
  'inbox-empty': {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M22 12h-6l-2 3h-4l-2-3H2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" fill="none" stroke="currentColor" stroke-width="2"/>`,
  },
  compass: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
  },
  sparkles: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M12 3l1.8 5.4a2 2 0 0 0 1.3 1.3L20.5 12l-5.4 1.8a2 2 0 0 0-1.3 1.3L12 20.5l-1.8-5.4a2 2 0 0 0-1.3-1.3L3.5 12l5.4-1.8a2 2 0 0 0 1.3-1.3L12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  refresh: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M21.5 2v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.34 15.57A9 9 0 1 1 18.36 5.64l3.14 2.36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  'square-stop': {
    viewBox: '0 0 24 24',
    svgInner: `<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>`,
  },
  'figure-toy': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v8.5M8 10.5l4 1 4-1M9.5 21l2.5-5 2.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="20.5" width="14" height="2" rx="1" fill="currentColor"/>`,
  },
  sun: {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  },
  moon: {
    viewBox: '0 0 24 24',
    svgInner: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  'sun-moon': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>`,
  },
  'circle-fill': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="7" fill="currentColor"/>`,
  },
  'circle-half': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor"/>`,
  },
  'circle-empty': {
    viewBox: '0 0 24 24',
    svgInner: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>`,
  },
};
