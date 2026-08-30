// Single dark-first theme for the voice-first app. Kept tiny on purpose —
// Phase 0 has one screen. Mirrors daily-budget's centralised-theme approach so
// a future design pass (or dark/light toggle) only touches this file.

export const colors = {
  bg: '#0B1120', // slate-950-ish
  bgAlt: '#111A2E',
  card: '#172036',
  border: '#243049',

  primary: '#38BDF8', // sky-400 — the "listening" accent
  primaryDark: '#0EA5E9',
  primarySoft: '#0C2A3E',

  danger: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',

  text: '#F1F5F9',
  textMute: '#94A3B8',
  textFaint: '#64748B',
  onPrimary: '#04121D',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const font = { xs: 12, sm: 14, md: 16, lg: 20, xl: 26, xxl: 34, display: 44 } as const;
