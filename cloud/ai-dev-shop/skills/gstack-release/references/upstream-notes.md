# Upstream Notes

## Source

- Repo: `https://github.com/garrytan/gstack`
- Local source: `/Users/la/Desktop/Multi-Agent Swarm Foundation/other-repos-to-learn-from/gstack`
- Source commit: `cab774cc`
- Adapted source files: `ship/SKILL.md`, `land-and-deploy/SKILL.md`, `canary/SKILL.md`, `landing-report/SKILL.md`, `setup-deploy/SKILL.md`

## Kept

- Branch readiness and pre-flight checks
- Changelog/version/PR discipline as explicit gates
- Merge/deploy readiness preview
- Post-deploy canary monitoring
- Read-only landing/release status reporting

## Stripped

- Generated shared preambles and Claude-specific AskUserQuestion plumbing
- Telemetry/config setup, gbrain integration, and local state scripts
- gstack version queue scripts, workspace-aware ship internals, and hardcoded release binaries
- Any automatic push, merge, deploy, rollback, or destructive cleanup behavior
