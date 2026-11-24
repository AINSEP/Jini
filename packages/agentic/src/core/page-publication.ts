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
export function pageActionNeedsConfirmation({ capabilityId, element }: { capabilityId: string; element?: PublishedPageElement | undefined }, _options = {}): boolean {
  return capabilityId === 'page.fill' || capabilityId === 'page.select_option' || (capabilityId === 'page.click' && element?.action === 'submit');
}

/** Action classes a published element must carry before an automatic page tool may target it.
 * Automatic clicks are reviewed UI operations; anchors must use validated navigation, so a click
 * never reaches an element published only as `navigate`. Tools absent here are not gated by class. */
const PUBLISHED_ACTION_CLASSES: Readonly<Record<string, readonly PublishedPageAction[]>> = {
  'page.fill': ['fill'], 'page.select_option': ['select'], 'page.click': ['menu', 'tab', 'accordion', 'carousel', 'media', 'submit'],
};

/** Whether `capabilityId` may act on `element` under a server-issued manifest. Navigation and
 * discovery need no published element; every other gated tool needs one of its reviewed classes.
 * @complexity O(1). */
export function pageActionPublishedForTarget({ capabilityId, element }: { capabilityId: string; element?: PublishedPageElement | undefined }, _options = {}): boolean {
  if (capabilityId === 'page.navigate' || capabilityId === 'page.find_elements') return true;
  if (!element) return false;
  const allowed = PUBLISHED_ACTION_CLASSES[capabilityId];
  return !allowed || allowed.includes(element.action);
}

/** The manifest element a page-tool call addresses by its `handle` argument, if any.
 * @complexity O(e) in published elements. */
export function findPublishedPageElement({ input, publication }: { input: unknown; publication: PagePublication }, _options = {}): PublishedPageElement | undefined {
  const handle = (input as Record<string, unknown> | null)?.handle;
  return publication.elements.find(element => element.handle === handle);
}

/** Server-issued action classes determine both eligibility and forced confirmation: resolves the
 * addressed element from the publication, then applies {@link pageActionNeedsConfirmation}.
 * @complexity O(e) in published elements. */
export function publishedPageActionNeedsConfirmation({ capabilityId, input, publication }: { capabilityId: string; input: unknown; publication: PagePublication }, _options = {}): boolean {
  return pageActionNeedsConfirmation({ capabilityId, element: findPublishedPageElement({ input, publication }) });
}
