---
name: posthog
description: Connect the site to PostHog product analytics. Use when the person says "connect PostHog", "set up analytics", "add product analytics", "track events in PostHog", or asks whether PostHog is working.
---

# PostHog

The host sends product analytics through the PostHog provider plugin, `analytics-posthog`. This plugin
only knows how to set it up; it holds no key and runs no code.

It is part of `analytics-posthog` and turns on and off with it: there is no separate switch for this plugin.

## Set it up

1. Check status: `provider_status {pluginId:"analytics-posthog"}`.
   - Not listed: the provider plugin is not installed. Say so in one line; inspect the installed plugin list to see what is.
   - `enabled: false`: offer to turn it on with
     enable the plugin with confirmation (the person confirms).
   - `usedByThisSite: false` with a `keyId`: ask "Use the saved PostHog key for <site>?".
     Yes → `project_key_use {keyId, use:true}`. To use a different key, open the card;
     it saves for this site only when other sites use the project key.
   - `configured: true`: say it is already connected. Open the card again only if they ask to change it.
2. Say in one sentence what the card is for, then open it:
   open the secure connection card.
   The card asks for the region (US Cloud is the default, EU Cloud, or Custom for a self-hosted
   URL) and the Project API key (PostHog → Project settings → Project API key, starts with `phc_`).
3. After it saves: the key is saved to your project; no site uses it yet. Ask the result's
   `ask` ("Apply this PostHog key to <site>?"). Yes → `project_key_use {keyId, use:true}`;
   it applies now. If the result says `appliesAt: "restart"`, offer `site_restart`.
   No → it stays saved for later. An already-attached or site-only save applies now.

## Rules

- Never ask for the key in chat and never put a key in any tool argument. The card is the only way in.
- Changing the region needs the key entered again; the card says so if they try.
- Owner events go out only with the operator's analytics consent; that is the host's setting, not PostHog's.
