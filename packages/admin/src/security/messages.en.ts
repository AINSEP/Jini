export const securityMessagesEn = { security: 'Secrets', accessTokens: 'Access tokens', rootKey: 'Root key', denied: 'Permission denied', loading: 'Loading credentials…', remove: 'Remove credential', replace: 'Replace', save: 'Save', cancel: 'Cancel',
  kicker: 'Settings', description: 'Every saved credential and the key that protects them, in one place.', tabsLabel: 'Security views',
  accessTokensHandleLabel: 'Switch to the Access tokens tab', rootKeyHandleLabel: 'Switch to the Root key tab',
  rootKeyScope: 'This key protects saved credentials. Keep its backup separate from the database.',
  rootKeyScopeProduction: 'On a production install this key is stored next to the database. A full server backup holds both the data and the key that unlocks it.',
  rootKeyBadgeNone: 'None', rootKeyBadgeFile: 'Active: key file', rootKeyBadgeEnv: 'Active: environment variable {name}', rootKeyBadgeEnvUnnamed: 'Active: environment variable',
  rootKeyFingerprint: 'Fingerprint', rootKeyFingerprintHint: 'A short ID for this key. It changes if the key changes.',
  rootKeyNoteInvalidEnv: 'A key is set in the {name} environment variable, but it is not in a usable format. Fix that value on the server to resolve this.',
  rootKeyNoteInvalidEnvUnnamed: 'A key is set in an environment variable, but it is not in a usable format. Fix that value on the server to resolve this.',
  rootKeyNoteInvalidFile: 'This key file is not in a usable format and must be replaced on the server:',
  rootKeyNoteEnv: 'This key was set directly on the server rather than as a file, and it is already active. Changing it means updating it on the server and restarting.',
  rootKeyNoteFile: 'Stored in a file on this server, at', rootKeyNoteNone: 'A key is created automatically when this install starts.' } as const;
/** A host translator: it receives a message key (the names above) and returns display copy. */
export type SecurityTranslator = (key: string, vars?: Record<string, string | number>) => string;
/** Default copy; unknown keys stay visible and variables use the native string formatter. */
export const englishSecurity: SecurityTranslator = (key, vars = {}) => {
  const template = Object.hasOwn(securityMessagesEn, key) ? securityMessagesEn[key as keyof typeof securityMessagesEn] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => vars[name] === undefined ? placeholder : String(vars[name]));
};
