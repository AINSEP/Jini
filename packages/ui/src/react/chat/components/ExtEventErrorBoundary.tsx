/**
 * @module ExtEventErrorBoundary
 *
 * Isolates one `kind: 'ext'` event group's renderer from the rest of the chat transcript.
 * `ext-event-renderer-registry.ts`'s renderers (a host's own, or a protocol package's like
 * `@jini-ai/agentic/a2ui`'s `A2uiSurfaceCard`) run inline during `MessageRow`'s render, over
 * agent-authored payloads — a malformed data-model binding, an unbounded recursive component
 * tree, or any other adversarial/unvalidated shape a renderer doesn't itself defend against can
 * throw during React's render phase. Before this module, there was no error boundary anywhere in
 * `packages/chat-react/src` or any host's `src` (verified by grep before writing this) — an
 * uncaught render-phase throw from a single message's ext event unmounts the entire chat React
 * root: blank page, lost transcript, lost draft. This confines that blast radius to the one
 * `<div>` the failing group would have occupied.
 *
 * React error boundaries must be class components (no Hook equivalent exists as of React 19).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ExtEventErrorBoundaryProps {
  /** The ext-event `name` this boundary wraps — surfaced in the fallback and passed to `onError`, so a host can tell which protocol/renderer failed. */
  name: string;
  /** Called once per catch, in addition to always rendering the built-in fallback — for a host that wants to log/report beyond what this module does on its own. */
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface ExtEventErrorBoundaryState {
  error: Error | null;
}

export class ExtEventErrorBoundary extends Component<ExtEventErrorBoundaryProps, ExtEventErrorBoundaryState> {
  override state: ExtEventErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ExtEventErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // React already surfaces this in the dev console via its own error-boundary reporting; this
    // adds the ext-event `name` React's generic report has no way to know, and gives a host a
    // hook to route it into its own error reporting.
    console.error(`[ExtEventErrorBoundary] ext event "${this.props.name}" failed to render:`, error);
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="jini-ext-event-error" role="alert" data-ext-event-name={this.props.name}>
          {`"${this.props.name}" failed to render: ${this.state.error.message}`}
        </div>
      );
    }
    return this.props.children;
  }
}
