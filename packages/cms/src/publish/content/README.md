# publish/content

Engine side of Publish Content: content hashing, readiness, peer URLs, the import executor, the
publish dialog (`dialog/`, own README) and the publishable-type registry (`type-registry.ts`).

## Wiring

`type-registry.ts` is generic over the host's port bag and has no default bag. The host:

- creates ONE registry instance at module scope with
  `createPublishContentTypeRegistry<HostPorts>()` in its own binding module, and exports that
  instance's `register` / `list` / `reset` / `buildCatalog` / `permissionsByType` to its
  composition roots (registration happens only there — never on import);
- instantiates `PublishContentDeps<HostPorts>` / `PublishContentContributor<HostPorts>` with its
  own port bag (`ports`, keyed by entity type) and supplies `workspaceId`, `clock`, `idGen`, and —
  only on the apply path — `changeSets` and `authorize`;
- answers publishing grants from `permissionsByType` (keyed by publish type) and reads the
  `publishType` stamp the registry adds to every handler `authorize` call.

Product copy, labels and the concrete port bag stay in the host.
