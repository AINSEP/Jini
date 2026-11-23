/**
 * @file Agentic page-publication and site-guide contracts. Additive copy of the type declarations in
 * `@jini-ai/agentic/core` (`page-publication.ts`, `site-guide/types.ts`); that package keeps its
 * identical declarations, its runtime policy and its exports until the paired cutover.
 *
 * Read-only learning contracts. Hosts supply facts; plugins supply prose, never read effects.
 */

/** Public annotations are eligibility only when present in a server-issued manifest. */
export type PublishedPageAction = 'read' | 'menu' | 'tab' | 'accordion' | 'carousel' | 'media' | 'fill' | 'select' | 'submit' | 'navigate';
export interface PublishedPageElement {
  readonly handle: string;
  readonly action: PublishedPageAction;
  readonly label?: string;
  readonly href?: string;
  readonly target?: { readonly action: string; readonly method: string };
}
export interface PagePublication {
  readonly revision: string;
  readonly elements: readonly PublishedPageElement[];
}

export interface GuidePointer {
  readonly label: string;
  readonly tool?: string | undefined;
  readonly href?: string | undefined;
  readonly permissions: readonly string[];
}
export interface GuideWorkflow {
  readonly title: string;
  readonly steps: readonly string[];
  readonly permissions: readonly string[];
}
export interface GuideTopic {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly explanation: string;
  readonly permissions: readonly string[];
  readonly pointers: readonly GuidePointer[];
  readonly workflows: readonly GuideWorkflow[];
}
