---
name: supabase
description: Set up a hosted database (Supabase) for this site from chat. Start by connecting the account, then find or create the database, handle Supabase's free limit of two active databases (reuse, pause, or paid), and say everything in plain words. Small database changes (make a table, add or change rows) run from chat with execute_sql, after the person confirms each one.
---

# Supabase database

## Connection card

Choose the card yourself from its `usedFor` list. Reuse a saved key or working sign-in for that
task. Never offer a replacement unless the person asks.

Connecting the account opens the plugin’s own **Connect Supabase** sign-in card, including what it connects and the permissions involved. Only if browser sign-in cannot start, open the secure connection card for the plugin’s access-token fallback. It links to personal access token creation, explains Management API permissions, probes the token and saves it on the MCP connection; it never saves a project anon or service-role key.

The person wants somewhere to keep data (sign-ups, form entries, app data). Get them a working
database with as few words and choices as possible. They should never need to learn a new idea.

## Rules for everything you say

Write every message in plain, short sentences. Lines quoted below as `> ...` are what the person
reads; say them in your own words if needed, but keep them this simple.

**Never say** any of these words or ideas to the person: token, access token, OAuth, MCP, plugin,
scope, allowlist, read-only, region, org or organization id, project ref, API key, service role,
tool names. Never show a key or password. Call the Supabase project "your database".

Links: always markdown links to `https://` pages, one per message at most.

Never loop. If a step fails twice, stop and use `references/failure-modes.md`.

## Step 1. Connect (always first)

Connect the account before any Supabase tool, every time, even if
you think it is already connected (it returns at once when it is).

It shows the person a card with a sign-in button. Before or with it, say:

> Let's set up your database. It's free and takes about two minutes. You'll sign in to Supabase,
> the database service this site uses. No account yet? Choose **Sign up** there (GitHub or email). If it
> asks which team to use, pick any.

The person signs up for their own Supabase account; you never make one for them and never ask for
their email or password.

- Result `{ status: "connected" }`: go to Step 2. (It also returns this at once when the person
  added a Supabase key while creating the site; say nothing about a sign-in then.)
- It fails with an error (sign-in could not start): see "Sign-in won't start" in
  `references/failure-modes.md`.
- Result `{ status: "waiting-for-sign-in" }`: see `references/failure-modes.md`.

## Step 2. Find their account and databases

1. Call `mcp__supabase__list_organizations`. Normally there is one; use it. If there are several,
   offer the choices using their names.
2. Call `mcp__supabase__list_projects`. Keep the ones in that organization.
3. If they already have databases, offer the choices:
   - **Make a new database** (first option, recommended)
   - **Use "<name>"** for each existing one

   If they pick an existing one, go to Step 5 (if its status is `INACTIVE` it is asleep: see
   `references/failure-modes.md`).

## Step 3. Check the free limit and the price

Supabase's free plan allows **two active databases** per account. `mcp__supabase__get_cost` can't
see the free limit (it says $0 even when the account is full), so count first:

- From Step 2's list, count databases whose status is not `INACTIVE` (active or starting).
- If the count is 2 or more and the cost below is $0, the account is at the free limit: skip
  creating and go straight to **At the free limit** below.

Call `mcp__supabase__get_cost { type: "project", organization_id }`.

- $0: say nothing about money.
- More than $0 (a paid account): offer the choices:
  - **Create it ($<amount>/<recurrence>)**, using the exact numbers returned
  - **Cancel**

  Only on **Create it**, call `mcp__supabase__confirm_cost` with the same `type`, `recurrence` and
  `amount`, and keep the returned id for Step 4.

## Step 4. Create the database

Call `mcp__supabase__create_project` with:
- `name`: short and lowercase, from the site's name or what they are building (never ask);
- `organization_id` from Step 2;
- `region`: nearest to the person, from the table below (default `us-east-1`);
- `confirm_cost_id` from Step 3 when there was one.

| Person is in | region |
|---|---|
| US East, Canada East, or unknown | `us-east-1` |
| US West | `us-west-1` |
| Canada | `ca-central-1` |
| South America | `sa-east-1` |
| UK, Ireland | `eu-west-2` |
| Western / Central Europe | `eu-central-1` |
| Nordics | `eu-north-1` |
| India | `ap-south-1` |
| Southeast Asia | `ap-southeast-1` |
| Japan | `ap-northeast-1` |
| Korea | `ap-northeast-2` |
| Australia, New Zealand | `ap-southeast-2` |

If it fails with an error containing
"maximum limits for the number of active free plan projects", the account is at the free limit: go
to **At the free limit**.

Then say:

> Creating your database... this usually takes 1-2 minutes.

Call `mcp__supabase__get_project` to check its status, at most 10 times in one reply. Ready when the
status is `ACTIVE_HEALTHY`. Still not ready after that:

> Your database is still being made. Say "check" in a minute and I'll look again.

## Step 5. Ready

> Your database is ready ✓ [Open it in Supabase →](https://supabase.com/dashboard/project/<id>)

(`<id>` is the project's `id` from Supabase; it goes only in the link, never in the text.)

Then offer one useful next step, for example showing them where their data will appear.

## Changing data or tables

For a small change the person asks for (make a table, add a column, add, change or delete rows), use
`mcp__supabase__execute_sql` on the database they chose, with one short SQL statement per call. Use
`mcp__supabase__apply_migration` only if they ask for a tracked schema change.

1. Say in one plain sentence what will change, and show the SQL in a code block:
   > I'll make a table called "signups" with an id column. This is the SQL:
2. Call the tool right away. Do NOT offer choices first or in words ("Shall I
   run this?"): the host's own approval card is the confirmation, and asking twice is annoying. The
   person sees the card with the exact SQL and **Allow** / **Allow for this chat** / **Cancel**;
   nothing runs until they allow it. Keep to one change per call. A card marked as able to delete
   data is expected for these tools.
3. After it runs, check the result (for example `mcp__supabase__list_tables`) and say what changed
   in plain words.

If the result says they cancelled, say:

> OK, I didn't change anything.

Do not try the same change again unless they ask. If the card expired, say it timed out and ask if
they still want it. Never delete a table or data they did not name. For a change that deletes data,
say plainly what will be lost in step 1; the approval card is still the only question you ask.

## At the free limit

Offer the choices (one option per active database for the first two):

- **Use "<name>"**: continue at Step 5 with that database.
- **Pause "<name>" to free a space**: call `mcp__supabase__pause_project` on it, say
  > "<name>" is paused. Its data is kept, and you can wake it up later.
  then go back to Step 4.
- **Get a paid database**: say
  > Supabase's free plan allows two active databases. To add another, upgrade your Supabase plan
  > here, then say "done". [See plans and prices →](https://supabase.com/dashboard/org/<organization id>/billing)

  On "done", go back to Step 3: `get_cost` now shows the price, so the person sees
  **Create it ($<amount>/<recurrence>)** before anything is charged.

This site never takes payment itself; upgrading happens on Supabase's own page.

## When something goes wrong

Use `references/failure-modes.md`: one plain sentence for each case, and what to do next.
