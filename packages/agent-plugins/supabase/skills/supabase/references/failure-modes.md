# Supabase: when something goes wrong

Each case: what you notice, what to tell the person (plain words, at most one link), and what to
do. Never paste Supabase's raw error text. Never retry more than once on your own.

## Sign-in not finished

The account connection returned `{ status: "waiting-for-sign-in" }` (nobody finished within a few
minutes, which is normal during a new sign-up).

> Still waiting for you to sign in to Supabase. Use the sign-in button above, then say "done".

On "done" (or "I'm back"), connect the account once more. Never call
it again on your own.

## Sign-in won't start

The account connection failed with an error instead of showing the sign-in card. Say:

> Sign-in isn't working right now, so let's use a key instead. [Make a key on Supabase →](https://supabase.com/dashboard/account/tokens)
> Then paste it in the box below.

Open the secure connection card once. It shows the box and waits. On
`{ saved: true }` go to Step 2. On `reason: "invalid"`: "That key didn't work. Make a new one and try
again." Never ask for the key in chat.

## They said no at Supabase

The person says they declined, cancelled, or closed the Supabase page.

> Supabase wasn't connected. You can try again whenever you like.

Stop. Start again at Step 1 only if they ask.

## At the free limit

`mcp__supabase__create_project` fails with an error containing
"maximum limits for the number of active free plan projects", or two databases are already active
on a free account. Use the skill's
**At the free limit** section: offer to use one, pause one, or get a paid database.

## The database is asleep

A database they picked has status `INACTIVE` (Supabase puts free databases to sleep after a week
without use).

> That database is asleep. Waking it up now, about a minute.

Call `mcp__supabase__restore_project`, then check with `mcp__supabase__get_project` (at most 10
times) until it is `ACTIVE_HEALTHY`.

## Creating failed

`mcp__supabase__get_project` shows `INIT_FAILED`.

> Supabase couldn't finish creating the database. Want me to try again?

On yes, go back to the skill's Step 4 once. Never remove or pause anything to fix this.

## They cancelled a change

The card showed the SQL and they clicked Cancel (the result says `cancelled`). Nothing ran.

> OK, I didn't change anything.

Don't retry it on your own. If they want a different change, show the new SQL first.

## A change to data or tables failed

`execute_sql` returned an error (a typo, a table that already exists, a missing table). Nothing was
changed. Say what went wrong in one plain sentence, show the corrected SQL, and ask before trying
again. For a big or risky change, offer the table editor instead:
[Open it in Supabase →](https://supabase.com/dashboard/project/<id>/editor)

## Connection stopped working

A Supabase call says the connection "is disconnected", "expired" or "was revoked", or fails with
401.

Request renewed browser sign-in for `supabase`, and say:

> Your Supabase connection stopped working. Sign in again to keep going.

After they sign in, retry the step once.

## Supabase is down or busy

A timeout, a connection error, a 5xx, or 429 (too many requests).

> Supabase isn't responding right now. Try again in a few minutes.

At most one retry later in the same conversation, never in a loop.

## A Supabase step is refused by the host

A call is refused as not allowed (for example `not-in-operator-allowlist`). This means the
connection's permissions were changed by someone on this site.

> That step isn't turned on for this site. An admin can turn it on in this site's settings.

Do not retry it.
