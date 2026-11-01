# @jini-ai/plugin-observability-sentry

## 0.6.16

### Minor Changes

- Add a pure host-fact policy for outbound observability and require explicit export eligibility in
  Sentry and OpenTelemetry provider factory options. Denied runtimes retain local admission while
  Sentry events, spans, native crash uploads and OTLP trace/metric export stay off. Consent remains
  independent. Hosts must supply the policy decision; rebuild and replace installed provider artifacts.

  Migration: Hosts must now pass `exportEnabled: true` in provider factory options to permit export.

