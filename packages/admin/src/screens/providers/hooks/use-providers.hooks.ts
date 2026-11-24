/**
 * @file The Providers page's controller, so the page component is only markup and tab wiring.
 *
 * ## Why this is its own hook and not a general settings hook
 *
 * The page's tabs used to be tabs of a larger settings controller, so the obvious move when they
 * were promoted to their own page was to keep calling that controller and read the fields off it.
 * That would have been wrong in a way worth stating: the settings controller mounts one
 * settings-ledger slice per namespace (execution, instructions, notifications, privacy,
 * appearance, language, interface), each of which issues its own load and owns its own
 * debounce/save chain. None of the Providers tabs reads any of them. Reusing it would have made
 * opening Providers fetch namespaces this page never displays and put this page's own render
 * behind "any slice loading", so an unrelated slow namespace would hold the External MCP panel
 * blank.
 *
 * So this composes only the controller the page genuinely needs: the External MCP controller
 * reads the `external_mcp_servers` table, not the settings ledger, which is exactly why it was
 * never a settings slice even while it lived on the Settings page.
 *
 * The External MCP hook is the host's own wired hook, so it arrives as a REQUIRED field; this
 * package neither imports nor defaults it.
 */

/** The page's controller: the External MCP tab's transport, field specs and restart-required flag. */
export interface ProvidersController<ExternalMcp> {
  externalMcp: ExternalMcp;
}

/**
 * @complexity O(1) — composes one constant-shaped controller, no iteration and no state of its own.
 */
export function useProviders<ExternalMcp>({ useExternalMcp }: { useExternalMcp: () => ExternalMcp }, _optional = {}): ProvidersController<ExternalMcp> {
  const externalMcp = useExternalMcp();

  return { externalMcp };
}
