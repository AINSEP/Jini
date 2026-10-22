/** Optional scripts require a stored visitor choice; necessary is never optional. */
export const CONSENT_CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'] as const;
export type ConsentCategory = typeof CONSENT_CATEGORIES[number];
export type ConsentChoices = Record<ConsentCategory, boolean>;
export type ConsentRegionMode = 'opt-in' | 'opt-out';
export type ConsentAction = 'accept' | 'reject' | 'save' | 'do-not-sell';
export const CONSENT_PLACEMENTS = ['bottom-bar', 'bottom-left', 'bottom-right', 'top-bar'] as const;
export type ConsentPlacement = typeof CONSENT_PLACEMENTS[number];

/** Bounded first-visit appearance; colors are opaque hex and must meet 4.5:1 contrast. */
export interface ConsentAppearanceTokens {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: string;
  padding?: string;
  fontSize?: string;
  maxWidth?: string;
}

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
  placement?: ConsentPlacement;
  secondaryLinkLabel?: string;
  secondaryLinkUrl?: string;
  appearance?: ConsentAppearanceTokens;
  customCss?: string;
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
