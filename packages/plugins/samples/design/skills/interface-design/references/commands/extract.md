# interface-design:extract

Extract a design system from existing UI code.

## What to Look For

- repeated spacing values
- repeated radius values
- common button sizes and padding
- repeated card treatment
- depth strategy, especially borders vs shadows

## Output Shape

```text
Extracted patterns:

Spacing:
  Base: 4px
  Scale: 4, 8, 12, 16, 24, 32

Depth: Borders-only

Patterns:
  Button: 36px h, 12px 16px pad, 6px radius
  Card: 1px border, 16px pad
```

## Workflow

1. Scan UI files.
2. Aggregate repeated values and component patterns.
3. Propose a system that matches the dominant pattern set.
4. Let the user customize before saving.
