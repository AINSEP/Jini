# Impeccable (Vendor Drop)

Source: https://github.com/pbakaus/impeccable
Installed via: `npx skills add pbakaus/impeccable --skill impeccable -a claude-code --copy`
License: see upstream repository

Do not hand-edit `SKILL.md`, `reference/`, `agents/`, or `scripts/` in this directory. They are maintained upstream. This README is a local addition.

## What it is

A frontend/UI design skill (v4.0.2) that evolved from Anthropic's `frontend-design` skill. It adds a shared design vocabulary of user-invokable commands (`polish`, `audit`, `critique`, `distill`, `harden`, `optimize`, `adapt`, `animate`, `colorize`, `extract`, `clarify`, `bolder`, `quieter`, live in-browser iteration, etc.) plus deterministic anti-pattern detector scripts for AI-generated frontend work.

## Updating

Run from the repo root:

```bash
npx skills add pbakaus/impeccable --skill impeccable -a claude-code --copy -y
```

The installer places files in `.claude/skills/impeccable/` (and may stage a copy under `.agents/skills/impeccable/`). Move them here to match this repo's convention of keeping vendor drops under the top-level `skills/` directory:

```bash
rm -rf skills/impeccable
mkdir -p skills/impeccable
cp -r .claude/skills/impeccable/. skills/impeccable/
rm -rf .claude/skills .agents/skills
```

Then update the hash in `skills/skills-lock.json` if it changed.

## Relationship to other design skills

This is a standalone, self-contained third-party skill (own commands, scripts, reference docs) rather than a shared reference loaded via progressive disclosure. It is not wired into any AI Dev Shop pipeline agent — see `framework/routing/skills-registry-exceptions.md`. Invoke it directly (`/impeccable` or by describing a design task) when you want its opinionated design/critique/polish workflow instead of, or alongside, `skills/ui-ux-design` (which now carries the premium-UI reference), or `skills/frontend-react-orcbash`.
