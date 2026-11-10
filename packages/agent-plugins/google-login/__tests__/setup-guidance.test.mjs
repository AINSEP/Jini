import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const skill = readFileSync(new URL('../skills/google-login/SKILL.md', import.meta.url), 'utf8');

test('Supabase instructions use its displayed callback and human-only secret entry', () => {
  const branch = skill.split('## Google via Supabase Auth')[1].split('## Troubleshooting')[0];
  assert.match(branch, /Supabase dashboard → Authentication → Providers → Google/);
  assert.match(branch, /same Google Client ID and Client Secret/);
  assert.match(branch, /directly in that Supabase panel themselves, never in chat/);
  assert.match(branch, /exact \*\*Callback URL \(for OAuth\)\*\*/);
  assert.match(branch, /Authorized redirect URIs/);
  assert.match(branch, /host's credential card is unnecessary unless this site also uses site members/);
  assert.match(branch, /both the Supabase callback and the host's callback/);
  assert.match(branch, /Authentication → URL Configuration/);
  assert.match(skill, /Never import the supabase plugin/);
  assert.match(skill, /check whether the supabase plugin is active at runtime/);
});

// The guide is host-neutral: it names the configured address and exact callback the host owns,
// while the host owns its callback route shape, first-link proof and unlink rules.
test('member guidance uses the exact callback for the configured site address and base path, and leaves linking to the host', () => {
  const branch = skill.split('## Site members')[1].split('## Google via Supabase Auth')[0];
  assert.match(branch, /Use the host's configured canonical\s+address and exact member sign-in callback URI, including any configured base path/);
  assert.match(skill, /Scheme, host, port, path and any configured base path must match exactly/);
  assert.match(skill, /`redirect_uri_mismatch`: compare the exact configured callback with Google's authorized list, including scheme, port and base path/);
  assert.match(branch, /secure connection card for the client ID and secret; never receive either secret in chat/);
  assert.match(branch, /host owns browser binding, state, PKCE, token validation, linking, unlinking and member\s+sessions/);
  assert.match(branch, /Verify sign-in, sign-out and unlinking through the host's existing member flow/);
});
