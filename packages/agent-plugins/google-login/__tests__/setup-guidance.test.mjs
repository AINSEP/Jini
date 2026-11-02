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
  assert.match(branch, /card is unnecessary unless this site also uses Tovu members/);
  assert.match(branch, /both the Supabase callback and Tovu's callback/);
  assert.match(branch, /Authentication → URL Configuration/);
  assert.match(skill, /Never import the supabase plugin/);
  assert.match(skill, /check whether the supabase plugin is active at runtime/);
});

test('Tovu guidance preserves configured base paths, requires first-link proof and explains unlink', () => {
  assert.match(skill, /configured canonical address/);
  assert.match(skill, /const callback = new URL\(configuredSiteAddress\)/);
  assert.match(skill, /encodeURIComponent\(workspaceId\)/);
  assert.match(skill, /target: "google-login-oauth-client"/);
  assert.match(skill, /@gmail\.com.*@googlemail\.com/);
  assert.match(skill, /Workspace accounts with an `hd` claim/);
  assert.match(skill, /one emailed code/);
  assert.match(skill, /issuer \+ subject, even if email changes/);
  assert.match(skill, /Unlink must remain effective on the next Google sign-in/);
  assert.match(skill, /Connect Google.*signed-in `\/account`/);
});
