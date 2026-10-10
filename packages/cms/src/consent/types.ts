/** Optional scripts require a stored visitor choice; necessary is never optional. */
export const CONSENT_CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'] as const;
export type ConsentCategory = typeof CONSENT_CATEGORIES[number];
export type ConsentChoices = Record<ConsentCategory, boolean>;
export type ConsentRegionMode = 'opt-in' | 'opt-out';
export type ConsentAction = 'accept' | 'reject' | 'save' | 'do-not-sell';

/** Text/policy content belongs to the host, not the mechanism. */
export interface ConsentConfig {
  enabled: boolean;
  regionMode: 'auto' | ConsentRegionMode;
  policyVersion: string;
  privacyPolicyUrl: string;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  preferencesLabel: string;
}

/** Immutable evidence; no IP, user-agent, or principal identity is collected. */
export interface ConsentRecord {
  id: string;
  timestamp: string;
  policyVersion: string;
  choices: ConsentChoices;
  regionMode: ConsentRegionMode;
  gpc: boolean;
  action: ConsentAction;
}

/** save must be durable before resolving, and must not overwrite an existing ID. */
export interface ConsentRecordPort {
  read(required: { id: string }, optional?: Record<string, never>): Promise<unknown>;
  save(required: { record: ConsentRecord }, optional?: Record<string, never>): Promise<void>;
}

export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
export const DENIED_CHOICES: Readonly<ConsentChoices> = Object.freeze({ necessary: true, functional: false, analytics: false, marketing: false });
