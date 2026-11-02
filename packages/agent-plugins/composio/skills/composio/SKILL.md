---
name: composio
description: Use the user's other apps (Gmail, Calendar, Slack, Notion, GitHub, HubSpot, 1000+ more) through Composio Connect, Composio's hosted MCP server. Covers connecting from nothing (one browser sign-in to Composio, no API key), the grants the connection needs, and the per-app flow - search for a tool, read its schema, connect the app with a Composio sign-in link, then execute.
---

# Composio: the user's other apps

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

`agent_plugin_connect {pluginId:"composio"}` shows the plugin-declared **Connect Composio** card. Review each app’s sign-in permissions and grant only the requested tools. This hosted connection declares no token fallback; do not request or save a Composio API key.

Composio Connect is an **external MCP server** at `https://connect.composio.dev/mcp`. It does not
expose one tool per app. It exposes a handful of meta-tools, and you reach every app through them.
Its tools arrive in chat as `mcp__composio__<TOOL>`.

| Tool | What it is for |
|---|---|
| `COMPOSIO_SEARCH_TOOLS` | Find the app tool that does what the user asked ("send an email", "create a Linear issue") |
| `COMPOSIO_GET_TOOL_SCHEMAS` | Read the exact inputs of the tools you found |
| `COMPOSIO_MANAGE_CONNECTIONS` | Check whether an app is connected; get a sign-in link for one that is not |
| `COMPOSIO_WAIT_FOR_CONNECTIONS` | Wait while the user finishes that app sign-in |
| `COMPOSIO_MULTI_EXECUTE_TOOL` | Run the app tool(s) |

## Connecting from nothing

**Never ask the user for a Composio API key, and never accept one pasted into chat.** Composio
Connect signs the user in by standard MCP OAuth in their browser. The host discovers Composio's
endpoints and registers its own client, so nobody types a URL, client id or secret.

1. **Turn the plugin on.** It ships disabled. Offer to enable it; on yes call `plugins_set_enabled`
   with `family: "agent-plugin"`, `pluginId: "composio"`, `enabled: true` (the user approves a
   dialog), or they use the **Agent Plugins** screen. Enabling creates the `composio` connection row.
2. **Sign in.** Call `agent_plugin_connect { pluginId: "composio" }`. It provisions the declared
   connection, shows the secure browser sign-in card and waits. On `status: "connected"`, continue;
   on `status: "waiting-for-sign-in"`, wait for the person to return, then call it again once.
   Say: "Sign in to Composio (free account; sign up there if you have none)." If it refuses because
   the site is not set up for sign-in from chat, follow the host guidance for signing in elsewhere;
   do not retry. Never create a second connection or use Bash, curl or a remote workbench to sign in.
3. **Grant the tools**, see [Grants](#grants). The host guidance says where grants are made and
   whether a saved grant needs an assistant restart before it takes effect.

Say plainly that steps 1 and 3 need a click from the user. Do not imply you can finish alone.

## Grants

In the host's settings for the `composio` connection, grant these tools:

- `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MANAGE_CONNECTIONS`,
  `COMPOSIO_WAIT_FOR_CONNECTIONS`, `COMPOSIO_MULTI_EXECUTE_TOOL`.
- Where the host asks for a separate write grant (it applies only to a tool that declares it
  writes), grant it for `COMPOSIO_MULTI_EXECUTE_TOOL` and `COMPOSIO_MANAGE_CONNECTIONS`. Without it
  the host refuses the tool and it simply never appears.

**Do not grant** `COMPOSIO_REMOTE_WORKBENCH` or `COMPOSIO_REMOTE_BASH_TOOL`. They run code on
Composio's servers; nothing the user asks for here needs them.

If an `mcp__composio__*` tool you expect is missing, do not invent a reason. Report what the
host's admissions or refusal notice says, or say you do not know and point the user at the host's
connection settings.

## Doing a task

1. `COMPOSIO_SEARCH_TOOLS` with the user's goal in plain words.
2. `COMPOSIO_GET_TOOL_SCHEMAS` for the tool you will use. Never guess argument names.
3. `COMPOSIO_MANAGE_CONNECTIONS` for that app. If it is not connected, give the user the sign-in
   link it returns ("Connect your Gmail here"), then `COMPOSIO_WAIT_FOR_CONNECTIONS`. Each app is
   connected once; it stays connected across sessions.
4. `COMPOSIO_MULTI_EXECUTE_TOOL`.

**Ask before anything that sends, posts, pays, or deletes** (an email, a Slack message, a payment,
removing a record): show what will go out and to whom, and run it only after the user says yes.
Reading (listing emails, events, issues) needs no confirmation.

Report what the tool actually returned. If it failed, say so with its error in one plain sentence.

## When it stops working

- **"is disconnected: its authorization expired or was revoked"**: call `external_mcp_reauth_prompt`
  for `composio`. After the user signs in again, retry the original call once.
- **An app's own sign-in expired** (the app tool fails with an auth error): run
  `COMPOSIO_MANAGE_CONNECTIONS` for that app again and give the user the new link.
- **The user wants to disconnect an app**: that is done in their Composio account, not on this site.
