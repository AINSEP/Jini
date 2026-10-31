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
/** Auto never bypasses human confirmation for form operations. Pure and runtime-neutral. */
export function pageActionNeedsConfirmation({ capabilityId, element }: { capabilityId: string; element?: PublishedPageElement }, _options = {}): boolean {
  return capabilityId === 'page.fill' || capabilityId === 'page.select_option' || (capabilityId === 'page.click' && element?.action === 'submit');
}
