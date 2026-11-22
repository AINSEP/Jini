# @jini-ai/agent-plugins/kuinetic

## 0.1.0

- First release as its own plugin, so kUInetic guidance can be updated without touching
  `ui-ux-design`. The content is the former `ui-ux-design` reference
  `skills/ui-ux-design/references/kuinetic-reference.md`, moved verbatim and split so the
  always-delivered `SKILL.md` stays under the 8 KiB automatic guidance limit: Detect, Install
  And Initialise, Attribute Grammar, Reduced Motion and Gotchas stay in `SKILL.md`; Reserved Keys,
  Effects By Family and Opt-In Tiers moved to `references/`, each named in a load-before-use table.
- Near the top, `SKILL.md` names the `load_agent_plugin` call that loads the `ui-ux-design` core
  before designing or redesigning a theme or page, since a kUInetic request can rank this plugin first.
