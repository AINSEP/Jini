# Foundations

Use this reference when creating or extending the visual system for a product or feature.

## Goals

- Define a stable visual foundation before designing individual screens.
- Give Programmer a constrained, reusable system instead of one-off styling decisions.
- Preserve existing product patterns unless the user explicitly wants a new direction.

## Required Decisions

1. Visual direction
2. Color and semantic token system
3. Typography hierarchy
4. Spacing scale
5. Layout/container/grid rules
6. Breakpoint behavior
7. Elevation, border, radius, and motion primitives

## Minimum Foundation Contract

### Visual Direction

Define:

- product character in 3-5 adjectives
- intended level of formality
- density target: compact, balanced, spacious
- contrast profile: restrained, moderate, bold
- reuse vs reinvention decision

If working within an existing system, document continuation rules instead of inventing a new style.

### Token Categories

Create or extend tokens for:

- surface/background
- text/foreground
- border/separator
- interactive/brand
- success/warning/error/info
- focus ring
- shadow/elevation
- radius
- spacing
- typography
- motion duration/easing

Prefer semantic names over raw color names.

### Typography

Define:

- display or hero style if needed
- heading scale
- body sizes
- caption/supporting text
- monospace usage if relevant
- line-height and weight rules

Check:

- readable body sizing on mobile first
- heading contrast and hierarchy
- no decorative type that harms readability

### Spacing

Use a consistent scale. Typical safe pattern:

- `4, 8, 12, 16, 24, 32, 48, 64`

Apply the same scale to:

- margins
- padding
- grid gaps
- section rhythm
- component spacing

### Layout

Define:

- max content widths
- section padding rules
- grid column behavior
- stack behavior on narrow screens
- sticky or persistent UI elements if any

Default to mobile-first.

### Breakpoints

Document behavior at:

- mobile
- tablet
- desktop
- large desktop if relevant

Describe behavior, not just widths:

- navigation changes
- card/list reflow
- sidebar collapse/expand
- media cropping
- density and spacing adjustments

## Theming

Do not require multiple themes by default.

If theming is in scope, define:

- what tokens change
- contrast rules
- image/media treatment changes
- persistence behavior

Do not add a theme toggle only because it is possible.

## Anti-Patterns

- hardcoded one-off colors across components
- spacing chosen ad hoc per screen
- headings without a system
- desktop-first layout that collapses poorly on mobile
- decorative motion without purpose
- dark mode or theme switching as mandatory default

## Output Checklist

- visual direction named
- semantic token groups defined
- typography hierarchy defined
- spacing scale defined
- breakpoints documented
- layout rules documented
- motion/elevation basics documented
- assumptions and constraints explicitly noted
