---
name: taste-skill
description: Router for the Leonxlnx/taste-skill anti-slop frontend design skill pack. Use when the user wants stronger visual "taste" on AI-generated UI — landing pages, portfolios, dashboards, redesigns of existing sites, brand kits, design-reference images, or Codex-style image-to-code work — and wants a specific named aesthetic or workflow (e.g. minimalist, brutalist, GSAP-motion-heavy, Google Stitch DESIGN.md, premium/high-end, or full-output-enforced generation) rather than this toolkit's native design skills. Not for backend-only work.
version: 1.0.0
---

# Taste-Skill Router

Entrypoint for the vendored `Leonxlnx/taste-skill` pack ("The Anti-Slop
Frontend Framework for AI Agents"). Load this file first, then load only the
one or two vendored subskills that match the task — do not read all 13.

## Sources

- Vendored at `<AI_DEV_SHOP_ROOT>/skills/taste-skill/vendor/`
- Imported from `https://github.com/Leonxlnx/taste-skill`
- Imported commit: `e988add20dab0fa97d7a76781c48961c8184288e`
- Imported on: 2026-07-26
- Local patches: none — vendor content is untouched. This router file is the only local addition.

To check for updates, compare the imported commit with:

```bash
git ls-remote https://github.com/Leonxlnx/taste-skill HEAD
```

## Relationship to this toolkit's own design skills

This entire pack is a third-party opinionated alternative to, not a
replacement for, `skills/ui-ux-design` (which now carries the premium-UI reference), `skills/interface-design`,
`skills/impeccable`, and `skills/advanced-frontend-architecture`. Reach for a
subskill below only when the user names one of its specific aesthetics or
workflows; otherwise prefer this toolkit's native design skills.

## Progressive Disclosure

Select by task — do not load more than one or two:

| Task trigger | Load |
|---|---|
| General anti-slop frontend design for landing pages, portfolios, redesigns — current flagship, infers direction from the brief, audit-first on redesigns | `vendor/design-taste-frontend/SKILL.md` |
| Same as above but the project depends on exact v1 behavior (pre-rewrite) | `vendor/design-taste-frontend-v1/SKILL.md` |
| Elite UX/UI + GSAP scroll-motion engineering: AIDA structure, wide editorial type, bento grids, ScrollTrigger pinning/stacking/scrubbing | `vendor/gpt-taste/SKILL.md` |
| Agency-grade "expensive" look: exact fonts, spacing, shadows, card structure, animation — blocks generic/cheap AI-design defaults | `vendor/high-end-visual-design/SKILL.md` |
| Auditing and upgrading an existing site/app to premium quality without breaking functionality, any CSS framework | `vendor/redesign-existing-projects/SKILL.md` |
| Clean editorial minimalism: warm monochrome, typographic contrast, flat bento grids, no gradients/heavy shadows | `vendor/minimalist-ui/SKILL.md` |
| Raw industrial/brutalist look: Swiss print type meets military terminal, rigid grids, analog degradation — dashboards, portfolios, editorial | `vendor/industrial-brutalist-ui/SKILL.md` |
| Generating a Google Stitch-compatible `DESIGN.md`: strict typography/color tokens, asymmetric layout, micro-motion rules | `vendor/stitch-design-taste/SKILL.md` |
| Premium brand-kit imagery: logo systems, identity decks, brand-guideline boards | `vendor/brandkit/SKILL.md` |
| Generating design-reference images only (no code) for a web landing page, one image per section | `vendor/imagegen-frontend-web/SKILL.md` |
| Generating design-reference images only (no code) for a mobile app screen/flow, phone-mockup framed | `vendor/imagegen-frontend-mobile/SKILL.md` |
| Codex-style workflow: generate the design image(s) first, then implement code to match them closely | `vendor/image-to-code/SKILL.md` |
| Any task (design or otherwise) at risk of truncated/placeholder output that must be exhaustive and unabridged | `vendor/full-output-enforcement/SKILL.md` |

If a task spans multiple concerns — e.g. a brutalist redesign of an existing
dashboard — load the smallest complete set: `redesign-existing-projects` for
the audit workflow plus `industrial-brutalist-ui` for the aesthetic.

## Precedence

Resolve conflicts in this order:

1. Active spec, explicit user constraints, constitution, security, privacy, and ADR boundaries.
2. This toolkit's own design skills, when the user has not named a specific taste-skill aesthetic.
3. The selected vendored subskill(s) above.
