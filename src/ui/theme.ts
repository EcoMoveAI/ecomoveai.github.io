import { useColorScheme } from 'react-native';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  accent: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  info: string;
  infoSoft: string;
}

const light: Palette = {
  bg: '#F5F7F4',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2EC',
  border: '#DCE3D9',
  text: '#16201A',
  textMuted: '#55635A',
  primary: '#1F7A4D',
  primaryText: '#FFFFFF',
  primarySoft: '#DDEFE3',
  accent: '#2E6F95',
  danger: '#B3261E',
  dangerSoft: '#F9DEDC',
  warning: '#8A5A00',
  warningSoft: '#FCEFD2',
  success: '#1F7A4D',
  info: '#2E5F8A',
  infoSoft: '#DCE9F5',
};

const dark: Palette = {
  bg: '#0F1512',
  surface: '#18211C',
  surfaceAlt: '#212C26',
  border: '#2E3B33',
  text: '#E7EEE9',
  textMuted: '#A3B2A8',
  primary: '#5CC48D',
  primaryText: '#062113',
  primarySoft: '#1E3A2A',
  accent: '#7DB7DB',
  danger: '#F2B8B5',
  dangerSoft: '#4A1E1C',
  warning: '#F2C46D',
  warningSoft: '#3D2E10',
  success: '#5CC48D',
  info: '#9CC3E6',
  infoSoft: '#1D2F40',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const font = { small: 13, body: 15, title: 18, h2: 22, h1: 28, display: 40 };
/** Minimum touch target (dp) per platform accessibility guidelines. */
export const MIN_TOUCH = 44;
