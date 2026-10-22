import type { AdminTheme } from './types.js';

/** Neutral chrome. Products supply their own brand theme instead of forking CSS. */
export const defaultAdminTheme: AdminTheme = Object.freeze({
  name: 'neutral',
  fonts: Object.freeze({ body: 'system-ui, sans-serif', heading: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' }),
  light: Object.freeze({ primary: '#363636', primaryInk: '#ffffff', bg: '#ffffff', surface: '#f5f5f5',
    text: '#202020', muted: '#666666', border: '#d9d9d9', danger: '#b42318', success: '#18763b', warning: '#845800' }),
  dark: Object.freeze({ primary: '#e0e0e0', primaryInk: '#202020', bg: '#171717', surface: '#242424',
    text: '#f0f0f0', muted: '#b3b3b3', border: '#454545', danger: '#ff8b80', success: '#79d69b', warning: '#ebc36b' }),
  radius: '8px', density: 1,
});
