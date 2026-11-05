# iOS Design Review

## When

Use to audit an iOS UI for Apple platform fit, Human Interface Guidelines alignment, accessibility, layout, and interaction quality.

## Workflow

1. Identify the target screen, flow, device class, and orientation.
2. Inspect screenshots, simulator/device state, SwiftUI/UIKit code, or design specs.
3. Check platform idioms: navigation, sheets, tab bars, safe areas, system controls, gestures, haptics, and system colors.
4. Check accessibility: Dynamic Type, VoiceOver labels, focus order, contrast, touch targets, Reduce Motion, and content size categories.
5. Check visual execution: spacing, hierarchy, typography, empty/error/loading states, truncation, and keyboard behavior.
6. Classify findings as blocker, should-fix, or polish.

## Output

- Evidence inspected
- HIG/platform findings
- Accessibility findings
- Specific fix recommendations
- Verification path

## Guardrails

- Do not invent HIG violations without evidence.
- Do not recommend custom controls when native controls meet the need.
- Do not require live hardware if screenshots or simulator evidence are enough; state the evidence quality.
