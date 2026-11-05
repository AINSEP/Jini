# taste-skill (Vendor Drop)

Source: https://github.com/Leonxlnx/taste-skill
Installed via: `npx skills add Leonxlnx/taste-skill --skill '*' -a claude-code --copy`
Imported commit: `e988add20dab0fa97d7a76781c48961c8184288e`
Imported on: 2026-07-26

Do not hand-edit any `SKILL.md` (or its `reference/`, `scripts/`, `assets/` siblings) under this directory. They are maintained upstream. This README and the router one level up (`skills/taste-skill/SKILL.md`) are the only local additions.

## Contents (13 subskills)

| Directory | What it is |
|---|---|
| `design-taste-frontend/` | Current flagship anti-slop frontend design skill |
| `design-taste-frontend-v1/` | Legacy v1, kept for exact backward compatibility |
| `gpt-taste/` | UX/UI + GSAP scroll-motion engineering |
| `high-end-visual-design/` | Agency-grade "expensive" visual design rules |
| `redesign-existing-projects/` | Audit + upgrade existing sites/apps to premium quality |
| `minimalist-ui/` | Clean editorial minimalism |
| `industrial-brutalist-ui/` | Raw industrial/brutalist aesthetic |
| `stitch-design-taste/` | Generates Google Stitch-compatible `DESIGN.md` files |
| `brandkit/` | Brand-kit image generation (logos, identity decks) |
| `imagegen-frontend-web/` | Web design-reference image generation only (no code) |
| `imagegen-frontend-mobile/` | Mobile app design-reference image generation only (no code) |
| `image-to-code/` | Codex-style: generate reference image(s) first, then implement to match |
| `full-output-enforcement/` | Anti-truncation output-completeness behavior; not design-specific |

## Updating

Run from the repo root:

```bash
npx skills add Leonxlnx/taste-skill --skill '*' -a claude-code --copy -y
```

The installer places files in `.claude/skills/<name>/` (one directory per subskill, and may stage a copy under `.agents/skills/<name>/`). Move them here to match this repo's convention of vendoring under the top-level `skills/` directory as an untouched, nested drop:

```bash
for s in .claude/skills/*/; do
  name="$(basename "$s")"
  rm -rf "skills/taste-skill/vendor/$name"
  cp -r "$s" "skills/taste-skill/vendor/$name"
done
rm -rf .claude/skills .agents/skills
```

Then update the hashes in `skills/skills-lock.json` and the imported-commit note in `skills/taste-skill/SKILL.md` if they changed.

## Relationship to the router

Nothing here is discovered directly by agents — the router at `skills/taste-skill/SKILL.md` (one level up) is the sole entrypoint and picks which of these to load per task. See `framework/routing/skills-registry-exceptions.md` for why only the router, not these nested files, appears in the skills registry.
