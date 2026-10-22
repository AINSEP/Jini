# Argument objects and skill installation

Public functions, constructors and ports use `(requiredArgs, optionalArgs)`. Empty required
inputs are `{}`; optional settings may be omitted. The existing export names are retained.

| Entry | Runtime | Surface |
|---|---|---|
| Root and `./core` | Universal | Page capability manifests, handles, guards, WebMCP/AG-UI projection, GenUI and MCP-UI wire helpers |
| `./a2ui` | Universal | Schemas, catalog, bindings, render tree and interpreter |
| `./dom` | Browser | DOM driver and host-injected native WebMCP detection |
| `./skills/install` | Node | Validation, bounded archive/GitHub import, installer, state, layout and live refresh |
| `./skills/install/node` | Node | Filesystem adapter; not exported from universal barrels |

## Migration examples

```ts
agentHandle({ handle: 'save' }, { role: 'button', label: 'Save' });
agentHandleProps({}, { base: 'row', action: 'remove', label: 'Remove' });
buildAgentListHandles({ prefix: 'rows', ids: ['one', 'two'] });
findCapability({ capabilities: PAGE_CAPABILITIES, id: 'page.click' });
executePageCapability({ driver, capabilityId: 'page.click', input: { handle: 'save' } });
driver.findElements({}, { role: 'button' });
driver.fill({ handle: 'title', text: 'New title' });
driver.selectOption({ handle: 'status', option: 'published' }, { selected: true });
createJsonRpcRequest({ id: 7, method: 'page.action' }, { params: { handle: 'save' } });

const encoder = createGenUiEncoder({ clock: { nowMs: () => Date.now() } });
encoder.encode({ event, runId }, { seq: 3 });
const interpreter = createA2uiInterpreter({ catalog, clock, ids });
interpreter.applyAgentMessage({ raw: message });
getAgentModelContext({ host: { candidates: () => [document.modelContext, navigator.modelContext] } });
```

Core clocks expose the zero-argument `nowMs()` getter. A2UI sequence IDs retain `next({})`. WebMCP execution receives `execute({ id, args })`.
Native browser WebMCP still receives its standard wire shape through the private adapter.
`resolveDynamicValue({ value, ctx }, { itemScope })` puts item scope in optional settings.

## Constructing an installer

```ts
import {
  createSkillFetchAdapter, createSkillInstaller, createSkillLayout,
  type ArchiveReaderPort, type ToolSourceLoaderPort, type YamlReaderPort,
} from '@jini-ai/agentic/skills/install';
import { createNodeSkillFilesystem } from '@jini-ai/agentic/skills/install/node';

declare const yamlReader: YamlReaderPort;
declare const archiveReader: ArchiveReaderPort;
declare const toolSourceLoader: ToolSourceLoaderPort;

const layout = createSkillLayout({
  root: '/var/lib/example/skills', stagingRoot: '/var/lib/example/skill-staging',
  workspaceDirectory: 'workspaces', stateFileName: '.installed.json',
});
const installer = createSkillInstaller({
  layout, filesystem: createNodeSkillFilesystem({}), yamlReader, archiveReader,
  fetch: createSkillFetchAdapter({ fetch: globalThis.fetch }),
  ids: { next: () => crypto.randomUUID() },
  toolId: ({ name }) => `skill_${name.replace(/-/g, '_')}`,
  toolSourceLoader,
}, { onChanged: async ({ workspaceId, toolId }) => { /* refresh this host's registry */ } });

await installer.installSkill({ workspaceId: 'local', files: uploadFiles });
await installer.installSkill({ workspaceId: 'local', archiveBase64 });
await installer.installSkill({ workspaceId: 'local', githubUrl: 'https://github.com/acme/skills' });
await installer.listManagedSkills({ workspaceId: 'local' });
await installer.setSkillEnabled({ workspaceId: 'local', toolId, enabled: false });
await installer.uninstallSkill({ workspaceId: 'local', toolId });
```

Roots are absolute and trusted; staging and final directories must support same-filesystem rename.
State filenames and tool-ID mapping are host policy; use the host's existing filename for existing
installations. `SkillFilesystemPort` and `FilesystemPort` name the same contract. Its `lstat`
must distinguish symlinks, and `readFile({ path, maxBytes })` must bound actual streamed bytes.
The native adapter opens state files with no-follow semantics. No environment or site-root default
is provided.

`yamlReader.read({ yaml })` must use a safe/failsafe schema and reject duplicate keys.
`archiveReader.open({ bytes })` returns lazy entries and `close({})`; entries supply path, kind,
size and `read({})` chunk streams. Reader/entry resources must close when iteration ends early.
`toolSourceLoader.load({ workspaceId }, { includeDisabled: true })` returns all managed tools
with their IDs, metadata and a single safe directory segment. CMS tool construction stays in the host.

The HTTP port is `fetch({ url }, requestOptions)`. The native adapter forwards the explicitly
supplied fetch, options, responses and failures. GitHub import refuses redirects, uses one
30-second deadline, pins a commit and caps downloaded bytes. Bundle limits remain 8 MiB combined,
256 files/entries, 1 MiB per file and 128 KiB for `SKILL.md`. Scripts are stored as data.
`SkillInputError({ message }, { cause })` preserves refusal messages.

Mutations serialize per resolved workspace within one installer instance. Cross-process coordination
belongs to the host. `onChanged({ workspaceId, toolId })` runs after persistence; if refresh fails,
the mutation has already completed and the caller must reconcile the registry rather than reinstall.

## Live registration and refresh

`createLiveSkillRegistration({ registry, inactiveError })` returns `replace({ tools })`.
Registry ports receive `list({})`, `has({ id })` and `register({ tool })`; authorization/handlers
receive `{ context }`. Retained slots route to current registrations; removed tools disappear from
discovery, deny authorization and throw the host's inactive error on execution.

`createSkillRefresher({ load, replace })` returns `refreshInstalledSkills({})`; concurrent requests
share a load, and failure releases the pending refresh for retry.
`createSkillRefreshMiddleware({ registry }, { onChanged })` returns middleware taking `{ next }`.
Its continuation receives `next({})` or `next({}, { error })`. Host HTTP frameworks adapt their
native continuation signatures at the boundary.

No new dependencies or versions were added. Verification is deferred by owner directive.

`defaultAgenticMessages` (root / `./core`) supplies the neutral navigation description. Hosts
replace copy through the existing `CapabilityDef.description` before projecting model tools;
IDs, schemas and capability policy remain intact. Both UI interpreters accept core `Clock`.
