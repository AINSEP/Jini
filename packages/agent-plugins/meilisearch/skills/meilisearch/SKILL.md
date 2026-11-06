---
name: meilisearch
description: Run the site's visitor search on a Meilisearch server. Covers what Meilisearch receives (public content only), which two values the host needs (server URL and API key), and what each search failure means in plain words.
---

# Run the site's search on Meilisearch

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Open **Connect Meilisearch** through the secure connection card. It collects your server’s HTTPS URL and a masked scoped key, and saves the search credential under the host-owned label. The card lists index, document, search, settings and task permissions. Create the key in your own instance/Cloud console; there is no universal instance-specific key-creation URL.

## Scope

This plugin owns the Meilisearch provider code; the host runs it only when the host shipped it.
The host's built-in search stays the default; Meilisearch answers only after the owner picks it for
the site.

**What Meilisearch receives:** the title, plain text, URL, collection and locale of each published,
publicly visible entry. Members-only or otherwise restricted content is never sent: the host removes it
from Meilisearch instead, and only the built-in search can find it for the visitors allowed to see
it. Every result Meilisearch returns is checked again against the site before a visitor sees it.

## Set it up

1. **Get a server.** Either Meilisearch Cloud or a self-hosted Meilisearch v1.x reachable from the host
   over HTTPS.
2. **Create a key.** Use a key that may create/delete the site index, add/replace and retrieve documents, update index settings, search and read
   tasks (a scoped key with the actions listed on the card). Never ask the person to paste the key
   into chat; use the plugin card above.
3. **Save the key on the site.** Open the plugin card above. Enter this server’s HTTPS URL and the key directly into the card. The host saves the fixed label and passes the URL as `host` and the token as `apiKey`.
4. **Switch the site to Meilisearch** in the site's search settings. The host builds a fresh index in the
   background and switches over only when it is complete, so search keeps working meanwhile.

## What a failure means

- `not_configured`: the host or API key is missing. Save both.
- `unauthorized` / `forbidden`: the key is wrong or lacks one of the actions above. Explain the refusal and needed access; replace the key only if asked.
- `rate_limited`: Meilisearch asked the host to slow down. The host waits and retries.
- `network`, `timeout`, `provider_unavailable`: the server could not be reached or is down. The host
  reconciles the index once it is back; nothing needs re-entering.
