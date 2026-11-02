---
name: opentelemetry
description: Connect the site's traces to an OpenTelemetry backend such as Grafana Cloud or Honeycomb. Use when the person says "set up OpenTelemetry", "send traces to Grafana", "connect Honeycomb", "add tracing" or "add observability", or asks whether tracing is working.
---

# OpenTelemetry (Grafana Cloud, Honeycomb…)

The host exports traces through the OpenTelemetry provider plugin, `observability-opentelemetry`, to any
OTLP/HTTP endpoint. This plugin only knows how to set it up; it holds no key and runs no code.

It is part of `observability-opentelemetry` and turns on and off with it: there is no separate switch for this plugin.

## Set it up

1. Check status: `provider_status {pluginId:"observability-opentelemetry"}`.
   - Not listed: the provider plugin is not installed. Say so in one line; `content_read.plugin` shows what is.
   - `enabled: false`: offer `plugins_set_enabled {family:"site-runtime", pluginId:"observability-opentelemetry", enabled:true}`.
   - `usedByThisSite: false` with a `keyId`: ask "Use the saved OpenTelemetry key for <site>?".
     Yes → `project_key_use {keyId, use:true}`. To use a different key, open the card;
     it saves for this site only when other sites use the project key.
   - `configured: true`: say it is already connected. Open the card again only if they ask to change it.
2. Say in one sentence what the card is for, then open it:
   `credential_save {kind:"plugin-provider", target:"opentelemetry"}`.
3. What goes in each field:
   - **Grafana Cloud:** your stack → OpenTelemetry → Configure. Endpoint like
     `https://otlp-gateway-prod-us-east-0.grafana.net/otlp`, Username = the instance ID (a number),
     Token = the access-policy token it creates. The host builds the Basic auth header; no base64 by hand.
   - **Honeycomb:** endpoint `https://api.honeycomb.io`, Username and Token blank, Extra headers
     `x-honeycomb-team=<ingest API key>` (Honeycomb reads its key from that header).
   - **Anything else:** its OTLP/HTTP base URL; traces go to `/v1/traces` under it.
4. After it saves: the key is saved to your project; no site uses it yet. Ask the result's
   `ask` ("Apply this OpenTelemetry key to <site>?"). Yes → `project_key_use {keyId, use:true}`;
   it applies now. If the result says `appliesAt: "restart"`, offer `site_restart`.
   No → it stays saved for later. An already-attached or site-only save applies now.

## Rules

- Never ask for a token in chat and never put one in any tool argument. The card is the only way in.
- Changing the endpoint or username needs the saved token and extra headers entered again; the card says so if they try.
