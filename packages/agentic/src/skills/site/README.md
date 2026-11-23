# skills/site

Site-side bindings of `skills/install` onto the core tool registry.

## Wiring

- `createLiveSkillRegistration(registry)`: the host passes its core `ToolRegistry` from its skills tool
  registrations.
- `createSkillRefreshMiddleware({ registry, onChanged })`: the host passes the registry (with its optional
  `refreshInstalledSkills` port) and an `onChanged` callback where it mounts the daemon request middleware.
