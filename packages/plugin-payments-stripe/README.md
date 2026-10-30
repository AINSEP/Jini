# @jini-ai/plugin-payments-stripe

Self-contained Stripe hosted Checkout provider artifact for the commerce kernel. Registers `payments/stripe` (contract version 1).

Resolve `@jini-ai/plugin-payments-stripe/package.json` with the host's Node package resolver,
discover the versioned artifact beneath `plugins/payments-stripe/<package-version>`,
and pass it through the existing Jini plugin installer and provider artifact loader.
Installation alone does not enable or configure the provider. This package has no runtime
npm dependencies and contains only this plugin's prebuilt payload and retained licenses.

Sources remain in `packages/provider-plugins/src/payments-stripe`. `build` and `prepack`
call the existing single-plugin builder; the generated `plugins/` payload is not source.
The npm version supplies the artifact version; SDK ranges and provider identities are preserved.

Preserves commerce Phase 1 hosted Checkout/evidence behavior. See NOTICE for the
Open SaaS source commit and complete MIT attribution retained in the artifact.
