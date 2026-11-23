/**
 * @file The provider-status tool's row and port shapes, and the host plugin-maturity vocabulary,
 * as types only.
 *
 * An additive copy of the declarations in `@jini-ai/agent-plugins/lifecycle/host-tools`
 * (`provider-status-tool.ts`, `identity.ts`); that package keeps its identical declarations,
 * values and exports until the paired cutover.
 */
import type { ToolExecutionContext } from '../../tool-registry.js';

/** @agent-note This projection contains manifest display metadata only. The host must never put saved setting values in it. */
export interface ProviderSettingFieldProjection {
 readonly name: string; readonly label: string; readonly secret?: boolean; readonly required?: boolean;
 readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
 readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
 readonly hint?: string; readonly default?: string; readonly options?: readonly { readonly value: string; readonly label: string }[]; readonly allowCustom?: boolean;
}

/** One provider plugin's status row; the composition root fills it from discovery, activation and the settings store. */
export interface ProviderStatusRow {
  readonly pluginId: string;
  /** Manifest declarations only; never saved values. */
  readonly fields?: readonly ProviderSettingFieldProjection[];
  readonly settingsCard?: { readonly tool: string; readonly input: { readonly kind: "provider-settings"; readonly target: string } };
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly store: "project" | "site";
  readonly appliesAt: "now" | "restart" | "failed";
  readonly keyId?: string;
  readonly usedByThisSite: boolean;
  readonly usedBy: readonly string[];
  readonly unreadable?: true;
  readonly quarantine?: string;
}

export interface ProviderStatusPorts {
  /** Every discovered plugin that declares provider settings; presence only. */
  readonly list: (required: Record<string, never>) => Promise<readonly ProviderStatusRow[]>;
  readonly authorize: (ctx: ToolExecutionContext) => Promise<void>;
}

/** Host metadata; absence keeps the plugin's normal presentation and behavior. */
export type PluginMaturity = 'untested' | 'soon';
