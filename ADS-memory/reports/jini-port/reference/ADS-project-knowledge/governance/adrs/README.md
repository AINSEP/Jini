# Governance ADR Registry

Cross-cutting Architectural Decision Records that apply across the entire project and outlive any single feature.

Unlike pipeline ADRs (scoped to `reports/pipeline/<NNN>-<feature-name>/adr.md`), Governance ADRs define durable rules, boundaries, and patterns that every agent must respect.

## Structure

- `ADR-INDEX.md` — Machine-scannable index. Implementation agents read this first to determine which ADRs apply to their target files.
- `GOV-ADR-<NNN>-<slug>.md` — Individual governance decision records.
- `ADR-EXCEPTIONS.md` — Ledger of documented exceptions to DEFAULT ADRs. Auto-created on first exception.

## Enforcement Levels

| Level | Meaning | Deviation allowed? |
|---|---|---|
| **DEFAULT** | Standard path — comply or explain | Yes, with documented exception |
| **MANDATORY** | Hard constraint | No — requires human approval to override |
| **ADVISORY** | Best-practice guidance | Yes, no documentation needed |

## Lifecycle

1. **Promotion:** Software Architect promotes cross-cutting decisions from pipeline ADRs using `framework/templates/governance-adr-template.md`.
2. **Consumption:** Implementation agents use `skills/adr-governance/SKILL.md` for just-in-time lookup by file path.
3. **Exception:** Agents record DEFAULT exceptions in `ADR-EXCEPTIONS.md`.
4. **Re-evaluation:** 3+ exceptions against the same ADR within 90 days triggers review. The ADR may be wrong, too broad, or outdated.
5. **Supersession:** New governance ADRs can explicitly supersede older ones. Mark the old one SUPERSEDED.

## Creating a Governance ADR

Use `<AI_DEV_SHOP_ROOT>/framework/templates/governance-adr-template.md` and save here as `GOV-ADR-<NNN>-<slug>.md`. Update `ADR-INDEX.md`.
