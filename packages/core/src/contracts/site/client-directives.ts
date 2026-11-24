/**
 * @file Human-only client channel: the wire union a host streams to its own browser client next to
 * (never inside) the transcript. Page control uses frontend sessions, not this channel. A host's
 * capability policy decides which directives a tool may raise; this module owns only the shapes.
 * Types only.
 */

/** A held tool execution waiting on the visitor's allow/deny decision. */
export interface ToolConfirmationDirective {
  readonly kind: "tool_confirmation";
  readonly challengeId: string;
  readonly title: string;
  readonly summary: string;
}

/** A tool-raised UI surface (`resource` is opaque to the transport). */
export interface UiSurfaceDirective {
  readonly kind: "ui_surface";
  readonly toolId: string;
  readonly resource: unknown;
}

export type ClientDirective = ToolConfirmationDirective | UiSurfaceDirective;
