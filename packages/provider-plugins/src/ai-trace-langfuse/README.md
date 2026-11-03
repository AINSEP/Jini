# @jini-ai/provider-plugins/ai-trace-langfuse

Self-contained Langfuse AI tracing provider artifact. Registers `ai_trace/langfuse` (contract version 1).

Resolve `@jini-ai/provider-plugins/package.json` with the host's Node package resolver,
discover the versioned artifact beneath `plugins/ai-trace-langfuse/<package-version>`,
and pass it through the existing Jini plugin installer and provider artifact loader.
Installation alone does not enable or configure the provider. The artifact has no runtime npm dependencies and contains only this provider's prebuilt payload
and retained licenses.

Sources remain in `packages/provider-plugins/src/ai-trace-langfuse`. The distribution’s `build` and `prepack`
call the existing single-plugin builder; the generated `plugins/` payload is not source.
The npm version supplies the artifact version; SDK ranges and provider identities are preserved.
