# skills/site

Site-side bindings of `skills/install` onto the core tool registry.

## Wiring

- `createLiveSkillRegistration(registry)`: the host passes its core `ToolRegistry` from its skills tool
  registrations.
- `createSkillRefreshMiddleware({ registry, onChanged })`: the host passes the registry (with its optional
  `refreshInstalledSkills` port) and an `onChanged` callback where it mounts the daemon request middleware.
- `resolveSkillLayout({ host, ... })` (`./layout.ts`): the host passes a `SkillSiteHost` where it resolves its
  booted skills layout (site composition and its test fixtures). The returned layout carries it, so
  `./install-service.ts`, `./tool-registrations.ts`, `./install-tool.ts` and the host's admin routes reach the
  same bindings through `skillLayout.host`: the override env variable name, the persisted install-state file
  name (keep it byte-stable), the process environment, the site-root resolver, the filesystem/archive/YAML
  install adapters, the frontmatter reader, the contained supporting-file reader, the per-root installer
  queues (host-owned state) and the tool permission check `skills_install` runs first.
  The same `SkillSiteHost` carries the two log reporters, because the engine never writes the console:
  `reportLifecycleEvent({ event })` (a `SkillLifecycleEvent`: installed / enabled-changed / removed, from
  `./install-service.ts`) and `reportSkippedFolder({ message })` (a skill folder `./tool-registrations.ts` skipped).
- Tool metadata for `skills_install` lives in `@jini-ai/core/tool-metadata/skills`.
