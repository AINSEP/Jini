---
name: expo-react-native
description: Expo and React Native skill router for official Expo AI skills plus local React Native performance guidance. Use when implementing, reviewing, planning, testing, deploying, upgrading, or debugging Expo/React Native apps; Expo Router navigation; native UI; API routes; EAS Build/Update/Submit/workflows; dev clients; Expo modules; NativeWind/Tailwind; DOM components; or mobile data fetching.
---

# Expo React Native Skill Router

Use this wrapper as the entrypoint for Expo and React Native work. It keeps the
official Expo skills progressively disclosed: load this file first, then load
only the one or two subskills that match the task.

## Sources

- Official Expo plugin vendored at `<AI_DEV_SHOP_ROOT>/skills/expo/`
- Imported from `https://github.com/expo/skills`
- Imported path: `plugins/expo/`
- Imported commit: `47f0ef64821f10e42a600758b5087bfe89c09474`
- Imported on: 2026-05-15
- Upstream HEAD at import time: `47f0ef64821f10e42a600758b5087bfe89c09474`
- Local patches: fixed broken vendored reference paths, completed README subskill list, and corrected one SwiftUI import example.
- Existing tactical React Native guidance: `<AI_DEV_SHOP_ROOT>/skills/vercel-react-native-skills/SKILL.md`

To check for updates, compare the imported commit with:

```bash
git ls-remote https://github.com/expo/skills HEAD
```

## Progressive Disclosure

Do not read every Expo skill. Select by task:

| Task trigger | Load |
|---|---|
| Expo Router UI, native-feeling screens, tabs, stacks, modals, sheets, media, icons, animations, storage, search, native tabs, WebGPU/Three.js in Expo | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/building-native-ui/SKILL.md` |
| Any Expo/React Native network request, API call, data fetching, caching, offline support, React Query, SWR, or Expo Router loader | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/native-data-fetching/SKILL.md` |
| Expo Router API routes, EAS Hosting API routes, server-side secrets, CRUD handlers, auth, CORS, webhooks, or database access from routes | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-api-routes/SKILL.md` |
| Tailwind CSS, NativeWind, react-native-css, utility styling setup in Expo | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-tailwind-setup/SKILL.md` |
| Web-only libraries inside Expo native apps, DOM components, charts, rich text, HTML/CSS layouts, iframe/embed work | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/use-dom/SKILL.md` |
| Custom development builds, Expo dev clients, native-code testing, TestFlight dev builds | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-dev-client/SKILL.md` |
| Expo native modules or views, config plugins, Swift/Kotlin modules, autolinking, lifecycle hooks | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-module/SKILL.md` |
| `@expo/ui/swift-ui` components or modifiers | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-ui-swift-ui/SKILL.md` |
| `@expo/ui/jetpack-compose` components or modifiers | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-ui-jetpack-compose/SKILL.md` |
| EAS workflow YAML, `.eas/workflows/`, build pipelines, PR preview workflows, CI/CD automation | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-cicd-workflows/SKILL.md` |
| EAS Build/Submit, App Store, Play Store, TestFlight, web hosting, deployment runbooks | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/expo-deployment/SKILL.md` |
| Expo SDK upgrades, dependency conflicts, New Architecture migration, deprecated package replacement | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/upgrading-expo/SKILL.md` |
| EAS Update rollout health, crash rates, launches, install counts, channel health, payload size | `<AI_DEV_SHOP_ROOT>/skills/expo/skills/eas-update-insights/SKILL.md` |
| React Native list performance, rendering pitfalls, animation performance, image performance, native navigation tactics, state/render optimization | `<AI_DEV_SHOP_ROOT>/skills/vercel-react-native-skills/SKILL.md`; then load only the matching `rules/*.md` files |

If a task spans multiple concerns, load the smallest complete set. Example:
an Expo screen with server data usually needs `building-native-ui` and
`native-data-fetching`; a release workflow needs `expo-cicd-workflows` and
possibly `expo-deployment`.

## Precedence

Resolve conflicts in this order:

1. Active spec, explicit user constraints, constitution, security, privacy, and ADR boundaries.
2. Project memory and existing app conventions.
3. Official Expo skills for Expo platform behavior, Expo Router, EAS, SDK upgrades, and Expo APIs.
4. Local React Native tactical guidance for rendering, performance, animations, and list behavior.
5. General React/web guidance only when the project has a web or Next.js surface.

## Agent Use

- Programmer: activate for Expo/React Native implementation, debugging, SDK upgrades, native modules, API routes, or EAS config changes. Load the target Expo subskill before editing.
- Software Architect: activate only when the ADR must choose Expo app topology, Expo Router/API route boundaries, native module strategy, EAS deployment/update strategy, or SDK-upgrade migration approach.
- Code Inspection: activate when a diff touches Expo/React Native UI, navigation, data fetching, API routes, native modules, Expo config, EAS workflow/deployment files, or SDK upgrades. Review against the exact subskill that matches the changed surface.
- QA/E2E: activate when validating Expo Router user journeys, deployment/update behavior, dev-client requirements, or Expo web/native preview flows.
- DevOps: activate for EAS workflows, EAS Build/Submit, app-store deployment, update health gates, and Expo deployment runbooks.

## Review Checklist

For any Expo/React Native task, explicitly identify:

- Expo SDK version and whether the task relies on SDK-specific APIs.
- Managed, prebuild, or bare workflow implications.
- Whether a native rebuild, dev client, or store build is required.
- Platform scope: iOS, Android, web, or all.
- Runtime evidence that is realistic for the scope: unit/integration tests,
  Expo start/build checks, EAS config validation, simulator/device evidence, or
  documented reason the runtime check cannot run locally.
