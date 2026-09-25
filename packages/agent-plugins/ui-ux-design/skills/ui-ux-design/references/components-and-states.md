# Components and States

Use this reference when defining the reusable UI pieces and behavior needed for implementation.

## Component-First Rule

Do not spec isolated screens only. Identify the reusable components first, then define where they are used.

## Minimum Component Inventory

Consider whether the feature needs:

- buttons and links
- text inputs, selects, checkboxes, radios, switches
- search/filter controls
- cards, lists, tables
- tabs, accordions, drawers, modals
- toasts, alerts, banners
- skeletons, spinners, progress indicators
- empty-state blocks
- navigation elements

## State Matrix

Every key interactive component should define:

- default
- hover
- focus-visible
- active/pressed
- disabled
- loading
- error
- success

Feature-level surfaces should also define:

- empty
- partial data
- failure/retry
- permission denied
- offline or degraded mode when relevant

## Interaction Rules

Document:

- trigger action
- feedback timing
- validation timing
- keyboard behavior
- focus movement
- escape and dismissal rules
- optimistic vs confirmed feedback

## Forms

Specify:

- visible labels
- helper text
- required/optional treatment
- inline validation behavior
- error copy style
- submit loading state
- success confirmation behavior

Do not rely on placeholder text as the label.

## Tables and Dense Data

Define:

- row density
- sorting/filter controls
- responsive fallback
- sticky columns/headers if needed
- loading and empty-state behavior
- selected-row or bulk-action behavior

## Navigation

Specify:

- information hierarchy
- current-page indicator
- hover/focus treatment
- mobile adaptation
- overflow behavior

## Anti-Patterns

- components with only happy-path states
- focus styles omitted because they "look ugly"
- error feedback shown only through color
- modal/dialog flows without focus return
- hover-only affordances on mobile-relevant UI
- components invented without checking existing system primitives

## Output Checklist

- component inventory listed
- state matrix covered
- interaction rules documented
- form behavior defined where needed
- navigation behavior defined where needed
- implementation notes point to reusable primitives, not one-off styling
