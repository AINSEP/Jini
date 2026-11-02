## Unreleased

- Ship the `posthog` agent plugin (the PostHog setup skill and key card, formerly a Tovu bundled plugin)
  in this package next to the `analytics-posthog` provider: payload `posthog/`, exports `./plugin.json` and
  `./posthog/*`. `build` and `prepack` run the provider builder, then the agent plugin assembler.

## 0.6.17

### Patch Changes

- Handle npm 12 pack JSON through the shared parser in packaging tests.

