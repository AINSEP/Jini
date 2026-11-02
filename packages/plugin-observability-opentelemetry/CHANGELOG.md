# @jini-ai/plugin-observability-opentelemetry

## Unreleased

- Ship the `opentelemetry` agent plugin (the OpenTelemetry setup skill and key card, formerly a Tovu bundled plugin)
  in this package next to the `observability-opentelemetry` provider: payload `opentelemetry/`, exports `./plugin.json` and
  `./opentelemetry/*`. `build` and `prepack` run the provider builder, then the agent plugin assembler.

## 0.6.17

### Patch Changes

- Handle npm 12 pack JSON through the shared parser in packaging tests.

## 0.6.16

### Minor Changes

- Add a pure host-fact policy for outbound observability and require explicit export eligibility in
  Sentry and OpenTelemetry provider factory options. Denied runtimes retain local admission while
  Sentry events, spans, native crash uploads and OTLP trace/metric export stay off. Consent remains
  independent. Hosts must supply the policy decision; rebuild and replace installed provider artifacts.

  Migration: Hosts must now pass `exportEnabled: true` in provider factory options to permit export.

