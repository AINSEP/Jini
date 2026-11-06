# Job forms-left: forms leftovers (owner-approved 11-05)
Plan: cloud/plans/V-forms-plan-result.md steps 3 and 4. Already built, do not redo: captured labels, consent wording and schema hash; the disk guard; Formspree. See cloud/reports/forms.md.
Do:
- Stale-form detection: render a schema hash, detect a stale browser form before acceptance, keep the safe answers and explain that the form changed.
- Recover original validation errors only from retained reports matched to receipt identities.
- Orphan files: proven form orphans become private and enter normal cleanup; ambiguous ones stay protected and are never guessed from filenames. Capture rendition keys before deleting records. Bounded, resumable work.
Move generic import orchestration from Tovu into Jini only where you touch it.
Do not add the storage_allocations table unless orphan cleanup truly cannot work without it; if so, stop on that part and say why. Report exactly what must be republished to Cloudflare.
Base: origin/cloud/combine in both repos, at its current tip. Branch cloud/forms-left from it. Do not push to cloud/combine. Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/forms-left.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
