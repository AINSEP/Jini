import type { ConsentConfig, ConsentRecord } from '../types.js';
export const now = '2026-10-09T12:00:00.000Z';
export const config: ConsentConfig = { enabled: true, regionMode: 'auto', policyVersion: '1', privacyPolicyUrl: '/privacy', title: 'Your cookie choices', message: 'Choose optional cookies.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Cookie preferences' };
export const accepted: ConsentRecord = { id: 'receipt_01234567890123456789', timestamp: now, policyVersion: '1', regionMode: 'opt-in', gpc: false, action: 'accept', choices: { necessary: true, functional: true, analytics: true, marketing: true } };
