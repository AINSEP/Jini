# Dispatching Parallel Agents Examples

Load this only when you want concrete split patterns.

## Example Domain Split

- test file A: abort behavior
- test file B: batch completion
- test file C: approval race conditions

Only parallelize if each domain can be fixed without shared files or shared state.

## Example Prompt Skeleton

```text
Scope: [one subsystem or one failure cluster]
Goal: [what must be fixed or learned]
Constraints: [what not to change]
Output: [summary, patch, findings, etc.]
```
