# Original Sources

This local skill was adapted from two LobeHub skill packages and merged into a single shared reference skill for this toolkit.

## Source Packages

1. `system-architecture`
- LobeHub page: `https://lobehub.com/en/skills/yennanliu-cs_basics-system-architecture`
- Marketplace package: `https://market.lobehub.com/api/v1/skills/yennanliu-cs_basics-system-architecture/download`
- Source emphasis: general distributed-systems design, capacity planning, architecture patterns, tradeoff analysis

2. `architecture-spec`
- LobeHub page: `https://lobehub.com/skills/rshankras-claude-code-apple-skills-architecture-spec`
- Marketplace package: `https://market.lobehub.com/api/v1/skills/rshankras-claude-code-apple-skills-architecture-spec/download`
- Source emphasis: architecture-document structure and detailed Apple-platform technical spec guidance

## Adaptation Notes

- The two packages were combined into one local `system-design` skill.
- The root `SKILL.md` was made general-purpose and pipeline-safe.
- Deep material was split into references instead of keeping a monolithic imported skill.
- Apple-platform assumptions from `architecture-spec` were isolated into `references/apple-platform-architecture.md`.
- The generic architecture-document shape was preserved in `references/architecture-spec-template.md`.

This is a derived toolkit skill, not a verbatim mirror of either marketplace package.
