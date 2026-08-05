# Computational Controls

Status: DRAFT

Declare the host project's executable quality commands here.

## lint
- Command: <fill during project bootstrap>
- Required: yes
- Blocking: yes

## typecheck
- Command: <fill during project bootstrap, or "N/A - dynamically typed">
- Required: <yes/no>
- Blocking: <yes/no>

## build
- Command: <fill during project bootstrap>
- Required: yes
- Blocking: yes

## unit_tests
- Command: <fill during project bootstrap>
- Required: yes
- Blocking: yes

## integration_tests
- Command: <fill during project bootstrap, or "not yet available">
- Required: no
- Blocking: no

## mutation_tests
- Command: <fill during project bootstrap, or "not declared">
- Working directory: <project root unless specified>
- Required: no
- Blocking: conditional
- Timeout: 600
- Success criteria: exit code 0 (full gate logic in sensor)
- Scope placeholder: {touched_files}
- Baseline location: <ADS_PROJECT_KNOWLEDGE_ROOT>/.local-artifacts/sensors/mutation-baseline.json
- Notes: triggered by TestRunner after green suite + coverage evaluation

## static_analysis
- Command: <fill during project bootstrap, or "none">
- Required: no
- Blocking: no
