/** Shared visitor-consent vocabulary for policies and exported widget metadata. */
export const CONSENT_CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'] as const;
export type ConsentCategory = typeof CONSENT_CATEGORIES[number];
