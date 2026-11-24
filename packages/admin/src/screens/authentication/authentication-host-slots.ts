import type { ComponentType, ReactNode } from "react";

/**
 * @file The host collaborators the Authentication screen renders or calls, as feature-owned shapes.
 * The host binds each one (its secret input, its settings-dialog shell with that shell's own i18n
 * provider and stylesheet, its theme-boundary and locale hooks) and passes it in; this folder
 * imports none of them.
 */

/** The host's secret input with a reveal toggle. `secret: false` renders a plain text field. */
export interface AuthenticationSecretInputProps {
  readonly label: string; readonly secret: boolean; readonly id: string; readonly defaultValue: string;
  readonly placeholder: string; readonly required: boolean; readonly autoComplete: string;
  readonly spellCheck: boolean; readonly "aria-describedby": string;
}

/** One tab of the inline settings shell: its nav label, heading copy and panel. */
export interface AuthenticationSettingsTab {
  readonly id: string; readonly label: string; readonly title: string; readonly subtitle: string; readonly panel: ReactNode;
}

/** What the screen hands the host's inline settings-dialog shell. */
export interface AuthenticationSettingsShellProps {
  readonly tabs: AuthenticationSettingsTab[]; readonly presentation: "inline"; readonly className: string;
  readonly fullscreenEnabled: boolean; readonly labels: { readonly kicker: string };
}

/** The host's theme-boundary hook: attributes spread onto the shell wrapper (e.g. `data-theme`). */
export type UseAuthenticationThemeBoundary = (
  required: object,
  optional: Record<string, never>,
) => { readonly [attribute: `data-${string}`]: string | undefined };

/** Shape aliases so a binding can name the slot component types in one import. */
export type AuthenticationSecretInput = ComponentType<AuthenticationSecretInputProps>;
export type AuthenticationSettingsShell = ComponentType<AuthenticationSettingsShellProps>;
