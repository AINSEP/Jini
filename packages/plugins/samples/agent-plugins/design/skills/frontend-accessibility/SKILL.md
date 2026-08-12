---
name: frontend-accessibility
version: 1.0.0
last_updated: 2026-02-26
description: WCAG 2.1 AA compliance guidance for frontend code review and E2E testing.
---

# Skill: Frontend Accessibility

Accessibility is not a feature — it is a baseline quality requirement. A UI component that cannot be operated via keyboard or read by a screen reader is broken for a significant portion of users. This skill provides the WCAG 2.1 AA checklist that Code Review and QA/E2E agents use to catch violations before they ship.

## WCAG 2.1 AA — What to Check in Code Review

### Perceivable
- All non-text content has a text alternative (`alt` on images, `aria-label` or `aria-labelledby` on icon buttons).
- Color is not the only means of conveying information (error state must also have text or icon, not just red color).
- Minimum contrast ratio: 4.5:1 for normal text, 3:1 for large text and UI components.
- No content flashes more than 3 times per second.

### Operable
- All functionality accessible via keyboard (Tab, Shift+Tab, Enter, Space, Arrow keys).
- Visible focus indicator on all interactive elements — never `outline: none` without a replacement.
- Skip navigation link for pages with repeated navigation.
- No keyboard traps — user can always Tab out of a component.

### Understandable
- Form inputs have associated `<label>` elements (not just placeholder text).
- Error messages identify the field and describe the error — not just "invalid input".
- Language attribute on `<html>` element.

### Robust
- Semantic HTML — use `<button>` for buttons, `<a>` for links, heading hierarchy (`<h1>` → `<h2>` → `<h3>`).
- ARIA roles only when native HTML semantics are insufficient.
- ARIA attributes used correctly — do not add `aria-label` to elements that already have visible text.

## Common Violations to Flag in Code Review

- `<div onClick>` instead of `<button>` — not keyboard accessible, no ARIA role.
- `<img>` without `alt` attribute.
- `<input>` without associated `<label>` (placeholder is not a label).
- Interactive element with no visible focus state.
- Hardcoded color values with insufficient contrast.
- Error state communicated only via color change.

## E2E Testing for Accessibility (axe-core integration)

- Inject `@axe-core/playwright` in E2E tests.
- Run `checkA11y()` after each page navigation and after dynamic content loads.
- Configure to WCAG 2.1 AA ruleset.
- Treat Critical and Serious violations as test failures.
- Moderate violations are warnings — log but do not fail.

## Keyboard Navigation Test Checklist

- [ ] Can reach all interactive elements via Tab
- [ ] Can activate buttons with Enter and Space
- [ ] Can navigate dropdowns/menus with Arrow keys
- [ ] Modals trap focus correctly (Tab stays inside modal while open)
- [ ] Focus returns to trigger element when modal closes
- [ ] Skip link present and functional on pages with navigation
