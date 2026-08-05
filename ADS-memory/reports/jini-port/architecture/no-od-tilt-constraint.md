# Round 2 — Binding constraint added by the user (applies to ALL seats)

The user has clarified the single most important requirement, and it overrides any round-1 assumption to the contrary:

**Jini is a GENERAL-PURPOSE reusable engine intended for MANY future projects — not for Open Design, and not for "Open Design + Tovu" specifically. The engine core must have NO Open Design tilt.**

Concretely:

1. **No OD tilt in the core.** Nothing Open-Design-specific may live in the engine packages. The core is designed to be adopted by arbitrary future products that are not yet known.
2. **Open Design is just the first consumer.** All OD-specific behavior — design systems, brands, design templates, figma, deploy, critique, marketplace, media pipeline, OD analytics, OD route shapes, OD data-root semantics — lives under `foundry/integrations/open-design/` (adapter + product data), NOT in the engine.
3. **Tovu (and any other current app) is another consumer, not a co-designer of the core.** Do NOT shape the core around the specific needs of OD or Tovu. The "two-consumer rule" is fine as an anti-over-abstraction check, but the target is genuine multi-project reusability, not a bespoke OD/Tovu shared core.
4. **This re-weights the evaluation.** Reusability and boundary-clarity (a second, third, Nth unrelated product can adopt the engine without importing product assumptions) now dominate. Any recommendation that gets the engine "born inside" the OD monorepo, or that treats OD product structure as the engine's natural shape, is disfavored unless it can show the core stays product-agnostic.

Every seat must now RE-EVALUATE its round-1 recommendation under this constraint: keep it, amend it, or change strategy — and say explicitly what changes and why.
