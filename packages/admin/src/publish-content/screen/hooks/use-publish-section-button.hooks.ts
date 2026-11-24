/**
 * @file Publish sections plan §2 S3 / plan G1 — the hook behind each list page's own
 * "Publish <section>" button. Kept out of the button component per the house rule that component
 * logic belongs in a hook, not the `.tsx` — the component only reads `{ label, onClick }` back.
 *
 * Label and scope both come from the host's one section table (`host.sectionById`), and a click
 * opens the SAME dialog the Dashboard wired (`host.requestPublish`) — a section button never plans
 * or publishes anything itself, it only narrows what the dialog opens scoped to.
 *
 * Host seam: the locale hook, the publish-to-live flag hook, the section table, the label
 * dictionary and the request store all arrive on `host`. Pass a module-level `host` object: its
 * hook fields are called on every render, so they must be stable across renders.
 */

/** The slice of one host section-table row this hook reads. */
export interface PublishSectionButtonSection {
  /** The section's own label copy key, e.g. "Publish pages". */
  readonly labelKey: string;
  /** Everything this section's button sends — the dialog's `scope.entityTypes`, verbatim. */
  readonly entityTypes: readonly string[];
}

/** What the host supplies so this hook stays free of its locale query, section table and copy. */
export interface PublishSectionButtonHost {
  /** The admin's current locale (a React hook). */
  useLocale(): string;
  /** The publish-to-live flag (a React hook) — the host's `createPublishToLiveAvailabilityStore` instance. */
  usePublishToLiveAvailable(): boolean;
  /** The host's section-table lookup by section id. */
  sectionById(required: { id: string }): PublishSectionButtonSection | undefined;
  /** Resolves a label copy key against the locale — the same dictionary the dialog's title reads from. */
  translate(required: { locale: string; key: string }): string;
  /** The host's publish-request store instance's `requestPublish`: `{}` criteria plus the section's
   *  whole entity-type set as the scope. Its result is not read here. */
  requestPublish(criteria: Readonly<Record<string, never>>, scope: { entityTypes: string[] }): unknown;
}

export interface PublishSectionButtonController {
  /** `false` on the live site, where there is nowhere to publish to — see
   *  `publish-availability.store.ts`. The button renders nothing then. */
  readonly visible: boolean;
  /** The section's own label, e.g. "Publish pages" — resolved against the caller's locale through
   *  the same dictionary the dialog's title reads from. */
  readonly label: string;
  /** Opens the Publish dialog scoped to this section's WHOLE `entityTypes` (e.g. collections sends
   *  `["content-type", "collection-entry"]`). `{}` criteria means "start with nothing ticked and let
   *  the dialog's own auto-plan populate it" — the Dashboard's unscoped button's starting shape. */
  readonly onClick: () => void;
}

/**
 * @param section Which publishable section this button opens the dialog scoped to.
 * @param host The REQUIRED host seam; see this file's header.
 * @complexity O(sections).
 */
export function usePublishSectionButton(
  { section, host }: { section: string; host: PublishSectionButtonHost },
  _options: Record<string, never> = {},
): PublishSectionButtonController {
  const locale = host.useLocale();
  // The host's section id type is derived from its table itself, so the lookup cannot miss.
  const entry = host.sectionById({ id: section });
  if (!entry) throw new Error(`publish section ${section} is missing`);
  const visible = host.usePublishToLiveAvailable();
  return {
    visible,
    label: host.translate({ locale: locale, key: entry.labelKey }),
    onClick: () => {
      host.requestPublish({}, { entityTypes: [...entry.entityTypes] });
    },
  };
}
