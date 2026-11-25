import { describe, expect, it } from 'vitest';
import { createDeployOpsToolMetadata } from '../deploy-ops.js';
import { createSiteBackupToolMetadata } from '../site-backup.js';
import { createAgentPluginsToolMetadata } from '../agent-plugins.js';
import { createPluginRuntimeToolMetadata } from '../plugin-runtime.js';
import { createSiteGuideToolMetadata } from '../site-guide.js';

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

describe('host-supplied vocabulary in the plugin and site-guide tool metadata', () => {
  it('places the bundled theme plugin id in the agent-plugin customize keywords only', () => {
    const metadata = createAgentPluginsToolMetadata({ bundledThemePluginId: 'host-theme' });
    expect(metadata.agent_plugins_customize.search.keywords).toBe(
      'edit customize change bundled agent plugin host-theme fork copy skills source EACCES PLUGIN_BUNDLED',
    );
    expect(metadata.agent_plugins_customize.approval).toEqual({ class: 'edit', confirmation: 'direct' });
    expect(createAgentPluginsToolMetadata({ bundledThemePluginId: 'other' }).agent_plugins_install).toEqual(metadata.agent_plugins_install);
  });

  it('places the plugin keyword in the plugins_install keywords', () => {
    const metadata = createPluginRuntimeToolMetadata({ pluginKeyword: 'host-plugin' });
    expect(metadata.plugins_install.search.keywords).toBe(
      'plugin plugins install add new upload folder zip attachment local package upgrade replace version site plugin host-plugin extension addon add-on',
    );
    expect(metadata.plugins_install.approval).toEqual({ class: 'edit', confirmation: 'direct' });
  });

  it('places the product name in the site-guide keyword (lower-cased) and example question', () => {
    const metadata = createSiteGuideToolMetadata({ productName: 'Acme' });
    expect(metadata.site_guide.search.keywords).toBe(
      'how acme works site guide learn building blocks forms widgets markers themes members SEO deploy plugins Acme',
    );
    const other = createSiteGuideToolMetadata({ productName: 'Zeta' });
    expect(other.site_guide.search.keywords).toBe(
      'how zeta works site guide learn building blocks forms widgets markers themes members SEO deploy plugins Zeta',
    );
    expect(JSON.stringify([metadata, other])).not.toMatch(/jini/i);
    expect(metadata.site_guide.search.queries).toEqual(['How does Acme work?', 'Design a planner directory site.']);
    expect(metadata.site_guide.approval).toEqual({ class: 'read', confirmation: 'direct' });
  });
});
