# Y5M API — Jini working-tree handoff

No commits, installs, builds, tests, typechecks or linters are run by this dispatch.
Tests are written before their implementation; mutations below are specified, not executed.
Only Jini is editable here. No host file has been certified G3 or deleted by this run.
Keep rules must be added by the host builder after its actual binding changes.

## Constraints

Use the sheet's existing owners and named splits, preserve effect ordering and legacy APIs.
No dependency versions or locks change. No subagents. No product strings in engine code.
The supplied sheets and existing implementations are the approved style and contract examples.

## Commit sequence

1. A3 — plugin memory (Jini built; unexecuted). Mutation: discoverSiblingsWithOwnership.
   Files: packages/agent-plugins/src/site/plugin-memory.ts, packages/agent-plugins/src/site/__tests__/y5m-plugin-memory.test.ts, packages/agent-plugins/package.json (exports only), .changeset/y5m-plugin-memory.md.
   Jini binding added; host must supply workspaceDirectory, parser identity policy and diagnostic sinks. No host keep rule certified.

2. A2 — upload ABI and install tools (Jini built; unexecuted). Mutation: skipLifecycleArchiveAdaptation (strict canonical {} and legacy zero-argument opens).
   A2 completion: packages/agent-plugins/src/site/{archive-reader-abi.ts,install-upload.ts,install-tool.ts}; tests src/site/__tests__/{y5-install-upload.test.ts,install-upload-update.unit.test.ts,y5m-install-tool.test.ts}; .changeset/y5m-plugin-upload-abi.md.
   Legacy exported AgentPluginsInstallToolDeps remains intact; old entry points adapt to the same operations. Both bound upload signatures preserve explicit-update result typing. Default readers stay canonical; legacy invocation overrides enter via toObjectArgArchiveReader. Required legacy install/update ports receive toZeroArgArchiveReader only at lifecycle egress.

3. A1 — scoped automatic guidance. Mutation: bindResolverAtFactoryConstruction.
   Files: packages/agent-plugins/src/site/automatic-agent-plugins.ts, packages/agent-plugins/src/site/__tests__/y5-automatic-agent-plugins.test.ts, .changeset/y5m-turn-guidance.md.
   Tests pin changing layout, construction/rejoin read counts and explicit inactive guidance.

4. A4 — existing Jini factory already binds provider links only when options.links is absent, at invocation; no production rewrite needed.
   Mutation: readProviderPortsAtBind. Tests: y5m-set-enabled-lazy.test.ts; changeset y5m-enable-lazy.md.
   Host still must replace its eager provider activation property with the specified getter.

5. H2 — request-scoped mount and OAuth (Jini built; unexecuted). Mutation: cacheFirstRequestDeps.
   Test-first mount probes: legacy transform, interleaved requests, static headers before binding before gates, factory throws.
   Files: packages/http-kit/src/{types,index,adapter,raw-route,adapter-request}.ts; packages/http-kit/src/__tests__/y5m-scoped-mount.test.ts; packages/cms/src/admin-http/routes/external-mcp/{oauth.ts,__tests__/y5m-oauth-mount.test.ts}; .changeset/y5m-request-deps.md.
   Existing public mount APIs retain static deps plus requestDeps; new mutually exclusive depsForRequest supplies the whole bag. No Express enters the CMS registrar.

6. H3 — plugin ZIP registrar. Mutation: parseZipInRequestDeps.
   Files: packages/cms/src/admin-http/routes/plugins/{install.ts,__tests__/y5m-install-registrar.test.ts}, .changeset/y5m-plugin-install-mount.md.
   Host supplies parserFactory (Express raw), and facts.parseZip(parser) that runs it only inside readZipUpload. No bodyParsers registration.

7. H4 — optional preview embeds. Mutation: coalesceMissingEmbedsToEmpty.
   Files: packages/cms/src/admin-http/routes/posts/{template-preview-render.ts,__tests__/template-preview-render.test.ts}, .changeset/y5m-preview-optional-embeds.md.
   Widened only the required embed return type. Existing per-call renderer composition retained.

8. H1 — passkey admission binding. Mutation: readPasskeyStoreBeforeStatusAdmission.
   Files: packages/user-management/src/admin-http/owner/{passkey-routes.ts,passkey-admission.ts,__tests__/y5-passkey-admission.test.ts}, .changeset/y5m-passkey-admission.md.
   Store captured once before MFA; WebAuthn and trusted site follow it. Registrar remains route-enumeration owner. Existing execute dispatch was not touched.

9. H5 — peer push scope and mapper. Mutation: defaultMissingDisclosureToFalse.
   Files: packages/cms/src/admin-http/routes/publish-content/{peer-transport.ts,route-helpers.ts,__tests__/y5m-peer-push-mount.test.ts}, .changeset/y5m-peer-publish-scope.md.
   Failure ports now receive optional method/route/disclosure from host; no literals substituted. Confirm's request factory needs no overwrite hook.

10. H6 — static publish registration. Mutation: capturePublishTrustAtRegistration.
    Files: packages/cms/src/admin-http/routes/system/publish-site/{destinations.ts,trigger.ts,__tests__/destinations.test.ts,__tests__/trigger.test.ts}, .changeset/y5m-publish-site-mount.md.
    New createPublishDestinationsRouteSpec takes no deps. Registrar takes spec + requestDeps with generic registry, peer, output and trust. Trigger retains generic config/registry/snapshot. Existing admin-publish-read unchanged.

11. W1 — configured site keyrings (Jini built; unexecuted). Mutation: skipPresentInvalidSource.
    Files: packages/platform/src/secrets/root-key/{ordered-keyring.ts,site-keyring-errors.ts,__tests__/y5-ordered-keyring.test.ts,__tests__/y5m-site-keyring-binding.test.ts}, .changeset/y5m-site-keyrings.md.
    Host supplies frozen salt, env/source policy, constructors, writer, directory prep, typed errors and copy. Existing exclusive-generator factory remains unchanged.


## Review corrections and deletions

- Removed the draft update-result assertion from the legacy tool adapter; preserved its overload by adapting through existing createAgentPluginUpload.
- Removed the draft replacement of exported AgentPluginsInstallToolDeps; its original host contract is retained.
- Removed the local updateMcpEffects function after injecting that operation; moved its existing why-comment to the legacy binding.
- Removed the moved request/body helper implementations from adapter.ts; their callers now import adapter-request directly. No forwarding shell.
- Kept legacy mounted deps captured at registration while deferring dependency factory calls until the binding point.
- Removed constant POST/template facts from peer registrar failure handlers so absent host facts stay undefined.
- Removed no existing tests or assertions. No exclusions, thresholds or suppressions changed.
- No host files deleted or certified G3. Keep-rules fence is deliberately empty until host edits land.

## Public export handoff

Only one new package subpath was needed (exports-map addition only):
- @jini-ai/agent-plugins/site/plugin-memory — bindAgentPluginMemory.

Additions to existing subpaths:
- @jini-ai/agent-plugins/site/automatic-agent-plugins — createScopedAutomaticPluginRuns; bindAutomaticGuidanceResolver now preserves the concrete layout type.
- @jini-ai/agent-plugins/site/install-upload — bindAgentPluginUpload, toObjectArgArchiveReader, toZeroArgArchiveReader.
- @jini-ai/agent-plugins/site/install-tool — bindAgentPluginsInstallTools.
- @jini-ai/platform/secrets/root-key/ordered-keyring — bindSiteKeyrings.
- @jini-ai/user-management/admin-http/owner/passkey-routes — bindOwnerPasskeyRoutes.
- @jini-ai/http-kit — RouteDepsSource.
- @jini-ai/cms/admin-http/routes/publish-content/route-helpers — createMappedErrorResponse.
- @jini-ai/cms/admin-http/routes/system/publish-site/destinations — createPublishDestinationsRouteSpec.

Existing exports changed in place:
- @jini-ai/agent-plugins/site/set-enabled — existing lazy factory characterized, no production rewrite.
- @jini-ai/cms/admin-http/routes/external-mcp/oauth — generic spec/deps mount port.
- @jini-ai/cms/admin-http/routes/plugins/install — parserFactory and request-bound deferred parser.
- @jini-ai/cms/admin-http/routes/posts/template-preview-render — optional embed result.
- @jini-ai/cms/admin-http/routes/publish-content/peer-transport — generic request factories and optional failure facts.
- @jini-ai/cms/admin-http/routes/system/publish-site/trigger — generic config, registry and snapshot.

Host binder details: ZIP facts.parseZip receives the one configured parser. Peer failure facts take method/registered route/disclosure directly from the current host response context and may omit all three. Keyring sealedWarning copy includes its original leading separator. Passkey services.completeOwnerPasskeyLogin is the host adapter that pins the session TTL.

## LEFT-DESKTOP / remaining host work

The dropped desktop dependency/package-lock refresh was not performed. Every host binding, caller rewrite and host deletion remains for the host builder; this dispatch touches Jini only. No OPUS/NEEDS-OPUS/REJECT sheets were identified and no anchor blocker stopped a Jini step.

## Validation and audit

32 test declarations added across the 16 named test files (16 -> 48 source declarations; parameterized cases expand later). All 11 sheet mutations are recorded above, not executed.

No execution evidence is claimed: tests, mutation runs, builds, installs, typechecks and linters were forbidden. Coordinator must execute the named tests and mutations.
Manual source/diff review: public legacy APIs retained; no new dependencies/versions, product identity, themes, re-export shells or suppressions. Static adapter split stays below 500 lines. Existing why-comments moved with their owners. Architecture audit: WARNING — source review found no boundary leak; compile/runtime evidence and host integration remain unverified. Runtime self-validation not run by dispatch instruction.

## Test-source inventory (not execution results)

Counts below are test declarations read from source; parameterized declarations expand at execution. No declaration was removed.

| Test file | HEAD declarations | Working-tree declarations |
|---|---:|---:|
| packages/agent-plugins/src/site/__tests__/install-upload-update.unit.test.ts | 2 | 3 |
| packages/agent-plugins/src/site/__tests__/y5-automatic-agent-plugins.test.ts | 5 | 7 |
| packages/agent-plugins/src/site/__tests__/y5-install-upload.test.ts | 2 | 4 |
| packages/agent-plugins/src/site/__tests__/y5m-install-tool.test.ts | 0 | 1 |
| packages/agent-plugins/src/site/__tests__/y5m-plugin-memory.test.ts | 0 | 4 |
| packages/agent-plugins/src/site/__tests__/y5m-set-enabled-lazy.test.ts | 0 | 2 |
| packages/cms/src/admin-http/routes/external-mcp/__tests__/y5m-oauth-mount.test.ts | 0 | 1 |
| packages/cms/src/admin-http/routes/plugins/__tests__/y5m-install-registrar.test.ts | 0 | 2 |
| packages/cms/src/admin-http/routes/posts/__tests__/template-preview-render.test.ts | 2 | 3 |
| packages/cms/src/admin-http/routes/publish-content/__tests__/y5m-peer-push-mount.test.ts | 0 | 2 |
| packages/cms/src/admin-http/routes/system/publish-site/__tests__/destinations.test.ts | 1 | 2 |
| packages/cms/src/admin-http/routes/system/publish-site/__tests__/trigger.test.ts | 1 | 2 |
| packages/http-kit/src/__tests__/y5m-scoped-mount.test.ts | 0 | 3 |
| packages/platform/src/secrets/root-key/__tests__/y5-ordered-keyring.test.ts | 2 | 3 |
| packages/platform/src/secrets/root-key/__tests__/y5m-site-keyring-binding.test.ts | 0 | 5 |
| packages/user-management/src/admin-http/owner/__tests__/y5-passkey-admission.test.ts | 1 | 4 |
