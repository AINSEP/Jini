# Upstream Notes

## Source

- Repo: `https://github.com/garrytan/gstack`
- Local source: `/Users/la/Desktop/Multi-Agent Swarm Foundation/other-repos-to-learn-from/gstack`
- Source commit: `cab774cc`
- Adapted source files: `ios-qa/SKILL.md`, `ios-fix/SKILL.md`, `ios-design-review/SKILL.md`, `ios-clean/SKILL.md`, `ios-sync/SKILL.md`

## Kept

- Live-device/simulator QA mindset
- Scenario evidence and failure reports
- Bounded iOS bug-fix loop
- HIG and accessibility design review
- Safe release cleanup and explicit debug-template sync

## Stripped

- Generated shared preambles and Claude-specific AskUserQuestion plumbing
- Telemetry/config setup, gbrain integration, and local state scripts
- gstack iOS daemon, remote tunnel, and hardcoded bridge binary assumptions
- Any automatic destructive cleanup or signing/deploy changes
