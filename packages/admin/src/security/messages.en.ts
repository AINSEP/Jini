export const securityMessagesEn = { security: 'Secrets', accessTokens: 'Access tokens', rootKey: 'Root key', denied: 'Permission denied', loading: 'Loading credentials…', remove: 'Remove credential', replace: 'Replace', save: 'Save', cancel: 'Cancel' } as const;
/** Page chrome copy, keyed by its English source so a host dictionary can translate it verbatim. */
export const securityChromeEn = {
  Operations: 'Operations',
  'One place to see every access token this install holds, and create, rotate, or remove one without hunting across the screens that created it.': 'One place to see every access token this install holds, and create, rotate, or remove one without hunting across the screens that created it.',
  'Switch to the Access Tokens tab — every access token and other saved credential this install holds, in one place': 'Switch to the Access Tokens tab — every access token and other saved credential this install holds, in one place',
  'Switch to the root key tab': 'Switch to the root key tab',
} as const;
export type SecurityTranslator = (key: string, vars?: Record<string, string | number>) => string;
/** Default copy; unknown keys remain visible and variables use the native string formatter. */
export const englishSecurity: SecurityTranslator = (key, vars = {}) => {
  const template = Object.hasOwn(securityChromeEn, key) ? securityChromeEn[key as keyof typeof securityChromeEn] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => vars[name] === undefined ? placeholder : String(vars[name]));
};
