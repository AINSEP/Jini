/**
 * @file Types for the plugin admin-surface values of the admin UI kit. They restate, locally, the
 * shapes the host's admin-surface protocol library accepts and returns (the host proves
 * compatibility with `satisfies AdminKit`), so this package's published types pin no plugin library.
 * The message envelopes are the host page's half of one sandboxed frame's conversation.
 */
import type { AdminSurfaceAction, AdminSurfaceActionOutcome, AdminSurfaceBootstrap } from '@jini-ai/core/contracts/site/agent-plugins-admin-surfaces';

/** The design tokens a surface may read; each is a custom property the host fills. */
export type AdminSurfaceThemeToken =
  | '--jini-bg' | '--jini-surface' | '--jini-bg-subtle' | '--jini-text' | '--jini-text-muted'
  | '--jini-border' | '--jini-border-strong' | '--jini-primary' | '--jini-primary-ink' | '--jini-link'
  | '--jini-danger' | '--jini-danger-bg' | '--jini-success' | '--jini-success-bg' | '--jini-warning' | '--jini-warning-bg'
  | '--jini-font-ui' | '--jini-font-mono' | '--jini-font-size-xs' | '--jini-font-size-sm' | '--jini-font-size-base' | '--jini-font-size-md'
  | '--jini-radius-sm' | '--jini-radius' | '--jini-radius-md' | '--jini-radius-pill'
  | '--jini-space-1' | '--jini-space-2' | '--jini-space-3' | '--jini-space-4'
  | '--jini-shadow-xs' | '--jini-shadow-sm' | '--jini-control-bg' | '--jini-control-border' | '--jini-control-shadow-focus'
  | '--jini-overlay-tooltip-bg' | '--jini-overlay-tooltip-text' | '--jini-overlay-tooltip-border';
export interface AdminSurfaceTheme {
  readonly scheme: 'light' | 'dark';
  readonly tokens: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>>;
}
export interface AdminSurfaceMessageEvent { readonly origin: string; readonly source: unknown; readonly data: unknown }
export interface AdminSurfaceMountRecord {
  readonly mountId: string;
  readonly frame: unknown;
  readonly descriptor: { readonly actions: readonly AdminSurfaceAction[]; readonly linkOrigins?: readonly string[] | undefined };
}
export interface AdminSurfaceActionRequest { readonly mountId: string; readonly requestId: string; readonly action: string; readonly payload: unknown }
/** A posted envelope; its `protocol`/`version`/`kind` fields are the protocol library's own. */
export interface AdminSurfaceEnvelope { readonly mountId: string }
export interface AdminSurfaceActionResponse extends AdminSurfaceEnvelope { readonly requestId: string }
export type AdminSurfaceMessageVerdict =
  | { readonly ok: true; readonly request: AdminSurfaceActionRequest }
  | { readonly ok: false; readonly ignored: string }
  | { readonly ok: false; readonly refused: string; readonly response: AdminSurfaceActionResponse };
export type AdminSurfaceLinkVerdict =
  | { readonly ok: true; readonly url: string; readonly response: AdminSurfaceActionResponse }
  | { readonly ok: false; readonly ignored: string }
  | { readonly ok: false; readonly refused: string; readonly response: AdminSurfaceActionResponse };
/** Opens an already-checked https URL however the host decides. */
export type AdminSurfaceOpenLinkPort = (required: { readonly url: string }, optional?: Record<string, never>) => void | Promise<void>;
export interface AdminSurfaceFrameAttributes {
  readonly src: string; readonly title: string; readonly sandbox: string; readonly referrerPolicy: 'no-referrer';
}
/** The admin-surface protocol functions the plugin screens call, injected as plain values. */
export interface AdminSurfaceProtocolKit {
  readonly adminSurfaceFrameAttributes: (required: { readonly src: string; readonly title: string }, optional?: Record<string, never>) => AdminSurfaceFrameAttributes;
  readonly readAdminSurfaceTheme: (required: { readonly style: { getPropertyValue(name: string): string }; readonly scheme: 'light' | 'dark' },
    optional?: { readonly sources?: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>> }) => AdminSurfaceTheme;
  readonly adminSurfaceThemeMessage: (required: { readonly mountId: string; readonly theme: AdminSurfaceTheme }, optional?: Record<string, never>) => AdminSurfaceEnvelope;
  readonly adminSurfaceInitMessage: (required: { readonly mountId: string },
    optional?: { readonly bootstrap?: AdminSurfaceBootstrap; readonly theme?: AdminSurfaceTheme }) => AdminSurfaceEnvelope;
  readonly adminSurfaceActionResponse: (required: { readonly request: Pick<AdminSurfaceActionRequest, 'mountId' | 'requestId'>; readonly outcome: AdminSurfaceActionOutcome },
    optional?: Record<string, never>) => AdminSurfaceActionResponse;
  readonly createAdminSurfaceMount: (required: { readonly surfaceId: string }, optional?: Record<string, never>) => { readonly surfaceId: string; readonly mountId: string };
  readonly openAdminSurfaceLink: (required: { readonly event: AdminSurfaceMessageEvent; readonly mount: AdminSurfaceMountRecord; readonly openLink: AdminSurfaceOpenLinkPort },
    optional?: Record<string, never>) => Promise<AdminSurfaceLinkVerdict>;
  readonly readAdminSurfaceResize: (required: { readonly event: AdminSurfaceMessageEvent; readonly mount: Pick<AdminSurfaceMountRecord, 'mountId' | 'frame'> },
    optional?: { readonly min?: number; readonly max?: number }) => number | null;
  readonly validateAdminSurfaceMessage: (required: { readonly event: AdminSurfaceMessageEvent; readonly mount: AdminSurfaceMountRecord }, optional?: Record<string, never>) => AdminSurfaceMessageVerdict;
}
