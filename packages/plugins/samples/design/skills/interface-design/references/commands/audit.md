# interface-design:audit

Check existing interface code against the active design system.

## When a System Exists

Audit for:

- spacing values that are off-grid
- depth violations such as unsupported shadows or borders
- colors outside the defined palette
- pattern drift in buttons, cards, inputs, tables, or surfaces

## Report Format

```text
Audit Results: src/components/

Violations:
  Button.tsx:12 - Height 38px (pattern: 36px)
  Card.tsx:8 - Shadow used (system: borders-only)
  Input.tsx:20 - Spacing 14px (grid: 4px, nearest: 12px or 16px)

Suggestions:
  - Update Button height to match pattern
  - Replace shadow with border
  - Adjust spacing to grid
```

## When No System Exists

- State that no design system is available yet.
- Recommend building one by implementing a screen or extracting patterns from existing code.

## Implementation Notes

- Read the active system file.
- Read the target files.
- Compare the code against the active direction, tokens, and patterns.
- Report violations with the smallest practical fix.
