# iOS QA

## When

Use to test an iOS app on a simulator or physical device and produce scenario-based evidence.

## Workflow

1. Inventory the project: Xcode workspace/project, scheme, app target, package manager, and test targets.
2. Check simulator or device availability. If unavailable, stop with a manual QA plan.
3. Confirm scenarios from the user or propose a short scenario list from the active feature context.
4. Build or launch only with user-appropriate commands for the current repo.
5. Execute each scenario and capture concrete evidence: screenshot, logs, observed state, accessibility state, or reproduction steps.
6. Classify each scenario as pass, fail, blocked, or not run.
7. For failures, include exact reproduction steps and likely owner files when evidence supports that.

## Output

- Environment and target inspected
- Scenario matrix
- Evidence summary
- Failures with reproduction steps
- Blockers and manual follow-up

## Guardrails

- Do not assume a live-device bridge exists.
- Do not claim hardware, simulator, or screenshot evidence without running or receiving it.
- Do not modify source code in QA mode unless the user changes scope.
