export const colors = {
  bg: '#02070C',
  bgAlt: '#06121A',
  card: '#081923',
  cardRaised: '#0A202C',
  border: '#123747',
  borderBright: '#1D697C',

  primary: '#44F1FF',
  primaryBright: '#C5FCFF',
  primaryDark: '#0CB2C6',
  primarySoft: 'rgba(68, 241, 255, 0.09)',
  primaryGlow: 'rgba(68, 241, 255, 0.28)',
  blue: '#278BFF',

  danger: '#FF5E78',
  dangerSoft: 'rgba(255, 94, 120, 0.10)',
  success: '#57F2B1',
  warning: '#FFD166',

  text: '#EAFDFF',
  textMute: '#8BA9B5',
  textFaint: '#4D7280',
  onPrimary: '#001014',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 } as const;
export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;
export const font = { xs: 11, sm: 13, md: 16, lg: 19, xl: 25, xxl: 32, display: 42 } as const;
