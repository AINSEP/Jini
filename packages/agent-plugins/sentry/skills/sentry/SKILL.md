---
name: sentry
description: Connect the site's error tracking to Sentry. Use when the person says "connect Sentry", "add error tracking", "report errors to Sentry", "set up crash reporting", or asks whether Sentry is working.
---

# Sentry

The host reports errors through the Sentry provider plugin, `observability-sentry`. This plugin only
knows how to set it up; it holds no key and runs no code.

It is part of `observability-sentry` and turns on and off with it: there is no separate switch for this plugin.

## Set it up

1. Check status: `provider_status {pluginId:"observability-sentry"}`.
   - Not listed: the provider plugin is not installed. Say so in one line; `content_read.plugin` shows what is.
   - `enabled: false`: offer `plugins_set_enabled {family:"site-runtime", pluginId:"observability-sentry", enabled:true}`.
   - `usedByThisSite: false` with a `keyId`: ask "Use the saved Sentry key for <site>?".
     Yes → `project_key_use {keyId, use:true}`. To use a different key, open the card;
     it saves for this site only when other sites use the project key.
   - `configured: true`: say it is already connected. Open the card again only if they ask to change it.
2. Say in one sentence what the card is for, then open it:
   `credential_save {kind:"plugin-provider", target:"sentry"}`.
   The card asks for the DSN (Sentry → Project settings → Client Keys (DSN)) and an optional
   environment name; blank means the host picks one for where the site runs.
3. After it saves: the key is saved to your project; no site uses it yet. Ask the result's
   `ask` ("Apply this Sentry key to <site>?"). Yes → `project_key_use {keyId, use:true}`;
   it applies now. If the result says `appliesAt: "restart"`, offer `site_restart`.
   No → it stays saved for later. An already-attached or site-only save applies now.

## Rules

- Never ask for the DSN in chat and never put it in any tool argument. The card is the only way in.
- Changing the environment needs the DSN entered again; the card says so if they try.
