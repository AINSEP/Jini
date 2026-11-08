import { parseMailProviderSetupProperty } from '@jini-ai/platform/mail';
/**
 * Contribution contracts: every `<host>-*.json` file a bundled Agent Plugin ships parses through a
 * public Jini export, and every module it declares passes that kind's public Jini module contract.
 *
 * The walk covers all bundled plugins in `packages/agent-plugins`. Every kind has a real check here. A
 * new kind, or a kind missing from the table, fails the inventory test instead of passing silently.
 * Modules are imported from the plugin folder itself, the same contained path the lifecycle imports.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineAgentPluginToolContribution } from '@jini-ai/agent-plugins/lifecycle/tools';
import { defineAdminSurfaceContribution, defineAdminSurfaceHandlerContribution } from '@jini-ai/agent-plugins/admin-surfaces';
import { defineExecutablePluginContribution, defineProviderContribution } from '@jini-ai/agent-plugins/lifecycle';
import { asMailAdapterModule, parseMailAdaptersFile } from '@jini-ai/agent-plugins/lifecycle/mail';
import { OBJECT_STORE_CONTRACT, objectStoreProviderFault } from '@jini-ai/core/object-store';
import { parseObjectStoresFile } from '@jini-ai/platform/object-store';
import type { PluginContributionDefinition, TrustedPluginPackage } from '@jini-ai/agent-plugins/lifecycle';
import { parseCredentialSchemesFile } from '@jini-ai/integrations/credentialed-http';
import { asApiConnectionHooksModule, parseApiConnectionsFile } from '@jini-ai/integrations/api-connections';
import { parseSourceControlProvidersFile, sourceControlProviderModuleError } from '@jini-ai/devops/source-control';
import {
  asDeployConfigGeneratorModule, asDeployOpsModule, asDeployTargetModule,
  parseDeployConfigsFile, parseDeployOpsFile, parseDeployTargetsFile,
} from '@jini-ai/devops/deploy';
import { defineSearchProviderContribution } from '@jini-ai/search/contribution';
import { parseConsentContributions } from '@jini-ai/cookie-consent/plugins';
import { asFormDestinationModule, formDestinationMissingMethods, parseFormDestinationsFile } from '@jini-ai/cms/forms';
import { parseLoginProviders } from '@jini-ai/user-management/server';

const PREFIX = 'tovu-';
/** The host's client-setting namespace the bundled connection files name: the file prefix, upper-cased. */
const CLIENT_NAMESPACE = `${PREFIX.slice(0, -1).toUpperCase()}_`;
const pluginsDir = fileURLToPath(new URL('../../../packages/agent-plugins/', import.meta.url));

/** One contribution file found on disk. */
interface ContributionFile { readonly pluginId: string; readonly packageRoot: string; readonly kind: string; readonly raw: string }

/** What a kind's check reports: the descriptor count and every refusal, so a failure names its cause. */
interface ContractResult { readonly descriptors: number; readonly refusals: readonly string[] }
type ContractCheck = (file: ContributionFile) => Promise<ContractResult>;

function contributionFiles(): ContributionFile[] {
  const files: ContributionFile[] = [];
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(pluginsDir, entry.name, 'plugin.json'))) continue;
    const packageRoot = join(pluginsDir, entry.name);
    for (const name of readdirSync(packageRoot)) {
      if (!name.startsWith(PREFIX) || !name.endsWith('.json')) continue;
      const kind = name.slice(PREFIX.length, -'.json'.length);
      files.push({ pluginId: entry.name, packageRoot, kind, raw: readFileSync(join(packageRoot, name), 'utf8') });
    }
  }
  return files.sort((a, b) => `${a.kind}/${a.pluginId}`.localeCompare(`${b.kind}/${b.pluginId}`));
}

/** The plugin's own default export, imported from its folder like the lifecycle's contained import. */
async function importDefault(required: { readonly plugin: TrustedPluginPackage; readonly modulePath: string }): Promise<{ readonly exported: unknown }> {
  const imported = await import(pathToFileURL(join(required.plugin.packageRoot, required.modulePath)).href) as { readonly default?: unknown };
  return { exported: imported.default };
}

/** Parse through the definition, then load each descriptor through its module contract. */
function viaDefinition<D, T>(definition: PluginContributionDefinition<D, T>): ContractCheck {
  return async file => {
    const parsed = definition.parse({ raw: file.raw });
    if (!parsed.ok) return { descriptors: 0, refusals: [parsed.reason] };
    const plugin = { pluginId: file.pluginId, packageRoot: file.packageRoot };
    const refusals: string[] = [];
    for (const descriptor of parsed.descriptors) {
      const loaded = await definition.load({ plugin, descriptor, importModule: importDefault });
      if (typeof loaded === 'string') refusals.push(loaded);
    }
    return { descriptors: parsed.descriptors.length, refusals };
  };
}

function allOf(...checks: ContractCheck[]): ContractCheck {
  return async file => {
    const results = await Promise.all(checks.map(check => check(file)));
    return { descriptors: Math.max(...results.map(result => result.descriptors)), refusals: results.flatMap(result => result.refusals) };
  };
}

/** Source control: the host validates its own credential and i18n extensions, so none are read here. */
const sourceControl: ContractCheck = async file => {
  const parsed = parseSourceControlProvidersFile({ raw: file.raw, readExtensions: () => ({ ok: true, extensions: {} }) });
  if (!parsed.ok) return { descriptors: 0, refusals: [parsed.reason] };
  const refusals: string[] = [];
  for (const descriptor of parsed.descriptors) {
    const { exported } = await importDefault({ plugin: file, modulePath: descriptor.module });
    const reason = sourceControlProviderModuleError({ value: exported });
    if (reason !== null) refusals.push(`${descriptor.id}: ${reason}`);
  }
  return { descriptors: parsed.descriptors.length, refusals };
};

/**
 * A kind whose parser and module validator are separate exports: the check composes the executable
 * definition the way a host does, since the capability package cannot import the lifecycle.
 */
function viaParserAndValidator<D extends { readonly id: string; readonly module: string }, M>(required: {
  readonly kind: string;
  readonly parse: (input: { readonly raw: string }) => { readonly ok: true; readonly descriptors: readonly D[] } | { readonly ok: false; readonly reason: string };
  readonly validate: (input: { readonly exported: unknown }) => M | string;
}): ContractCheck {
  return viaDefinition(defineExecutablePluginContribution<D, M>({
    filename: `${PREFIX}${required.kind}.json`, contribution: required.kind,
    parse: ({ raw }) => required.parse({ raw }), modulePath: ({ descriptor }) => descriptor.module,
    validate: required.validate, refusal: ({ descriptor, reason }) => `${descriptor.id}: ${reason}`,
  }));
}

/** JSON only: the kind declares no module. */
const credentialSchemes: ContractCheck = async file => {
  const parsed = parseCredentialSchemesFile({ raw: file.raw });
  return parsed.ok ? { descriptors: parsed.rules.length, refusals: [] } : { descriptors: 0, refusals: [parsed.reason] };
};

/** JSON only: a kind that declares no module, read through its one public parser. */
function jsonOnly(parse: (input: { readonly raw: string }) => { readonly ok: true; readonly descriptors: readonly unknown[] } | { readonly ok: false; readonly reason: string }): ContractCheck {
  return async file => {
    const parsed = parse({ raw: file.raw });
    return parsed.ok ? { descriptors: parsed.descriptors.length, refusals: [] } : { descriptors: 0, refusals: [parsed.reason] };
  };
}

/**
 * Form destinations: the module must be an object, and must also carry the methods its receive mode
 * needs. Object validation alone would pass a receiver with no `pull()`.
 */
const formDestinations: ContractCheck = async file => {
  const parsed = parseFormDestinationsFile({ raw: file.raw });
  if (!parsed.ok) return { descriptors: 0, refusals: [parsed.reason] };
  const refusals: string[] = [];
  for (const descriptor of parsed.descriptors) {
    const { exported } = await importDefault({ plugin: file, modulePath: descriptor.module });
    const module = asFormDestinationModule({ exported });
    const reason = typeof module === 'string' ? module : formDestinationMissingMethods({ entry: { descriptor, module } });
    if (reason !== undefined) refusals.push(`${descriptor.id}: ${reason}`);
  }
  return { descriptors: parsed.descriptors.length, refusals };
};

/** Every kind bundled plugins ship today, each read through its public Jini export. */
const CONTRACTS: Readonly<Record<string, ContractCheck>> = {
  'admin-surfaces': allOf(
    viaDefinition(defineAdminSurfaceContribution({ filename: `${PREFIX}admin-surfaces.json` })),
    viaDefinition(defineAdminSurfaceHandlerContribution({ filename: `${PREFIX}admin-surfaces.json` })),
  ),
  'agent-tools': viaDefinition(defineAgentPluginToolContribution({ filename: `${PREFIX}agent-tools.json` })),
  'connections': viaParserAndValidator({
    kind: 'connections', parse: ({ raw }) => parseApiConnectionsFile({ raw, clientNamespace: CLIENT_NAMESPACE }),
    validate: ({ exported }) => asApiConnectionHooksModule({ exported }),
  }),
  'consent': jsonOnly(parseConsentContributions),
  'credential-schemes': credentialSchemes,
  'deploy-configs': viaParserAndValidator({ kind: 'deploy-configs', parse: parseDeployConfigsFile, validate: asDeployConfigGeneratorModule }),
  'deploy-ops': viaParserAndValidator({ kind: 'deploy-ops', parse: parseDeployOpsFile, validate: asDeployOpsModule }),
  'deploy-targets': viaParserAndValidator({ kind: 'deploy-targets', parse: parseDeployTargetsFile, validate: asDeployTargetModule }),
  'form-destinations': formDestinations,
  'login-providers': jsonOnly(parseLoginProviders),
  'mail-adapters': viaParserAndValidator({ kind: 'mail-adapters', parse: ({ raw }) => parseMailAdaptersFile({ raw, parseSetup: parseMailProviderSetupProperty }), validate: ({ exported }) => asMailAdapterModule({ exported }) }),
  'object-stores': viaDefinition(defineProviderContribution({
    contract: OBJECT_STORE_CONTRACT, filename: `${PREFIX}object-stores.json`, parse: ({ raw }) => parseObjectStoresFile({ raw }),
    validate: ({ exported }) => objectStoreProviderFault({ provider: exported }) ?? exported,
  })),
  'search-providers': viaDefinition(defineSearchProviderContribution({ filename: `${PREFIX}search-providers.json` })),
  'source-control': sourceControl,
};

const files = contributionFiles();

describe('contribution contracts', () => {
  it('walks every contribution file, and each kind is in the contract table', () => {
    expect(files.length).toBeGreaterThanOrEqual(27);
    expect([...new Set(files.map(file => file.kind))].sort()).toEqual(Object.keys(CONTRACTS).sort());
  });

  for (const file of files) {
    const name = `${file.kind}: ${file.pluginId}`;
    it(`${name} parses through a public Jini export, and its modules pass that kind's contract`, async () => {
      const check = CONTRACTS[file.kind];
      if (check === undefined) throw new Error(`no contract for kind ${file.kind}`);
      const result = await check(file);
      expect(result.refusals).toEqual([]);
      expect(result.descriptors).toBeGreaterThan(0);
    });
  }
});
