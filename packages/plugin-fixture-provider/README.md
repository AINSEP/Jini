# @jini-ai/plugin-fixture-provider

Test-only provider artifact for plugin host conformance. Registers `fixture/fixture` (contract version 1).

Resolve `@jini-ai/plugin-fixture-provider/package.json` with the host's Node package resolver,
discover the versioned artifact beneath `plugins/fixture-provider/<package-version>`,
and pass it through the existing Jini plugin installer and provider artifact loader.
Installation alone does not enable or configure the provider. This package has no runtime
npm dependencies and contains only this plugin's prebuilt payload and retained licenses.

Sources remain in `packages/provider-plugins/src/fixture-provider`. `build` and `prepack`
call the existing single-plugin builder; the generated `plugins/` payload is not source.
The npm version supplies the artifact version; SDK ranges and provider identities are preserved.

For conformance tests only; never select this fixture as a production default.
