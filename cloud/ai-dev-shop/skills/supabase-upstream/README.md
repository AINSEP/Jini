# Supabase (Official Upstream)

Source: https://github.com/supabase/agent-skills
Installed via: `npx skills add supabase/agent-skills --skill supabase`
License: MIT

Do not hand-edit SKILL.md, CHANGELOG.md, references/, or assets/ in this directory. They are maintained by Supabase. This README is a local addition.

## Updating

Run from the repo root:

```bash
npx skills add supabase/agent-skills --skill supabase
```

The installer may place files in a temporary `.agents/skills/supabase/` staging directory instead of here. If that happens, move them:

```bash
mv skills/.agents/skills/supabase/SKILL.md skills/supabase-upstream/SKILL.md
mv skills/.agents/skills/supabase/CHANGELOG.md skills/supabase-upstream/CHANGELOG.md 2>/dev/null
cp -r skills/.agents/skills/supabase/references/ skills/supabase-upstream/references/ 2>/dev/null
cp -r skills/.agents/skills/supabase/assets/ skills/supabase-upstream/assets/ 2>/dev/null
rm -rf skills/.agents
```

Then update the hash in `skills/skills-lock.json` if it changed.

## Relationship to skills/supabase/

Our custom `skills/supabase/` is the canonical skill with MCP preflight gates, runtime verification, and framework-specific integration. This upstream directory provides supplemental content (CLI workflow, security checklist, MCP troubleshooting) loaded only on demand via progressive disclosure references in the custom skill.

## Note on skill identity

The upstream SKILL.md declares `name: supabase` which collides with our custom skill. This is intentional — the upstream is excluded from the skills registry via `framework/routing/skills-registry-exceptions.md` and should never be loaded directly by agent skill discovery. It is accessed only through explicit path references in the progressive disclosure sections.
