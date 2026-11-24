import { describe, expect, it } from 'vitest';
import { createDeployOpsToolMetadata } from '../deploy-ops.js';
import { createSiteBackupToolMetadata } from '../site-backup.js';

/**
 * Two metadata maps carry a host-owned word in their search queries (a product-named env var and a
 * product-named archive). The host passes that word in; these pin that it lands verbatim in the
 * same query slot, so the host's search vocabulary is unchanged by the package owning the map.
 */
describe('host-supplied tool-metadata vocabulary', () => {
  it('interpolates the site-key env var name into the deploy-ops secret queries', () => {
    const metadata = createDeployOpsToolMetadata({ siteKeyEnvName: 'HOST_SITE_KEY' });
    expect(metadata.deployment_ops_list_secrets.search.queries).toEqual([
      'Which secrets are set on my hosted app?', 'List the environment variables on the server.', 'Is HOST_SITE_KEY set in production?', "Show my app's secrets.",
    ]);
    expect(metadata.deployment_ops_set_secret.search.queries[0]).toBe('Set HOST_SITE_KEY on my host from my site key.');
    expect(metadata.deployment_ops_deploy.approval).toEqual({ class: 'publish', confirmation: 'policy' });
  });

  it('interpolates the archive label into the site-backup import and share queries', () => {
    const metadata = createSiteBackupToolMetadata({ archiveLabel: 'Acme ZIP' });
    expect(metadata.site_import_backup.search.queries).toEqual(['Install the site at this link', 'Import a Acme ZIP']);
    expect(metadata.site_share_create.search.queries).toEqual(['Share this site', 'Export this site as a Acme ZIP']);
  });
});
