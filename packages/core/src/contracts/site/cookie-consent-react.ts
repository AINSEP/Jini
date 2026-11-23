/**
 * @file Consent settings view contracts. Additive copy of the type declarations in
 * `@jini-ai/cookie-consent/react` (`ConsentSettingsPanel.tsx`); that module keeps its identical
 * declarations, its React components and its exports until the paired cutover. None of these
 * shapes reference React.
 */

/** Bounded appearance tokens, as the engine accepts them: opaque hex colors and `Npx` lengths. */
export interface ConsentAppearanceView {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: string;
  padding?: string;
  fontSize?: string;
  maxWidth?: string;
}

/** The host's consent configuration. The look fields are optional so older hosts stay valid. */
export interface ConsentSettingsView {
  enabled: boolean;
  /** @deprecated Retained for saved-settings compatibility; declared-script consent does not use it. */
  allowUnsafeEval?: boolean;
  /** Optional for older hosts; omitted uses the Jini banner when consent is enabled. */
  bannerMode?: 'jini' | 'headless' | 'off';
  regionMode: 'auto' | 'opt-in' | 'opt-out';
  policyVersion: string;
  privacyPolicyUrl: string;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  preferencesLabel: string;
  placement?: string;
  secondaryLinkLabel?: string;
  secondaryLinkUrl?: string;
  appearance?: ConsentAppearanceView;
  customCss?: string;
}

/** One validation result. `field` names the setting it belongs to; field-less problems are the host's to show. */
export interface ConsentFieldProblem {
  message: string;
  field?: string;
  code?: string;
}
