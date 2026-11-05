# Mechanical Subagent Delegation

Use this when the user asks for mechanical, low-reasoning work that mostly needs tool execution, data collection, or repetitive processing rather than senior judgment.

Good fits include launching Playwright to inspect pages, processing images, extracting tables or fields, collecting raw facts from files, running repetitive checks, transcribing/normalizing data, or producing a concise observation report for the parent agent.

Delegate only when subagent support is available and the task is bounded, low-risk, and easy to verify. The parent agent remains responsible for judgment, synthesis, user-facing conclusions, file edits, and any high-stakes decision.

Delegation rules:

1. Give the child a narrow mechanical task, exact inputs, expected output shape, and any tools it may use.
2. Prefer a cheaper/weaker/helper subagent when available; do not use a stronger model just to perform rote tool work.
3. Require the child to report observations and evidence, not recommendations unless explicitly requested.
4. Do not delegate work involving secrets, destructive actions, payments, production changes, or ambiguous judgment calls.
5. Verify important outputs before relying on them. Treat child output as evidence to inspect, not as final authority.
6. If the task touches repo code or pipeline personas, still follow delegated-agent bootstrap rules in `<AI_DEV_SHOP_ROOT>/skills/coordination/SKILL.md`.
