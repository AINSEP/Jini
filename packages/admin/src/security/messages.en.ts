export const securityMessagesEn = { security: 'Secrets', accessTokens: 'Access tokens', rootKey: 'Root key', denied: 'Permission denied', loading: 'Loading credentials…', remove: 'Remove credential', replace: 'Replace', save: 'Save', cancel: 'Cancel',
  kicker: 'Settings', description: 'Every saved credential and the key that protects them, in one place.', tabsLabel: 'Security views',
  accessTokensHandleLabel: 'Switch to the Access tokens tab', rootKeyHandleLabel: 'Switch to the Root key tab' } as const;
/** A host translator: it receives a message key (the names above) and returns display copy. */
export type SecurityTranslator = (key: string, vars?: Record<string, string | number>) => string;
/** Default copy; unknown keys stay visible and variables use the native string formatter. */
export const englishSecurity: SecurityTranslator = (key, vars = {}) => {
  const template = Object.hasOwn(securityMessagesEn, key) ? securityMessagesEn[key as keyof typeof securityMessagesEn] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => vars[name] === undefined ? placeholder : String(vars[name]));
};
