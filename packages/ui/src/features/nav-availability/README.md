# nav-availability

`navAvailability` (framework-free, exported from `@jini-ai/ui/core`): the `data-tip` / `title` /
`aria-description` attributes for a navigation button that may be unavailable. It keeps hover
explanations on `aria-disabled` buttons, since native `disabled` suppresses their tooltips.

## Wiring

The host injects `labels.unavailable` (its own "not available yet" copy). The host's navigation
adapter holds that copy and is what its top navigation and settings button call.
