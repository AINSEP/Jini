# `src/site/admin-surfaces`

Host-side admin-surface ports: capabilities, forms and public config.

## Wiring

- `public-config.ts` (`./site/admin-surfaces/public-config`): the host injects `env` (its configuration
  source) and `publicNamePattern` (its allow-list of public plugin-config names) on `required`; this
  module always refuses a name with a secret word. Bound where the host builds its
  `AdminSurfaceCapabilitiesPort`.
- `capabilities.ts` / `forms.ts`: the host binds them where it builds that same port.
