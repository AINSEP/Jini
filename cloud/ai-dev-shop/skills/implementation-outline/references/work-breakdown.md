<!-- Source: Addy Osmani / agent-skills / planning-and-task-breakdown -->

# Work Breakdown

## Part 1: Task Sizing

| Size | Scope | Time estimate | Example |
|---|---|---|---|
| XS | 1 file | Under 30 min | Rename a label, adjust validation copy, add a missing test case |
| S | 2-3 files | ~1 hour | Add a field to a form and submit payload |
| M | 4-7 files | ~half day | Add a new API endpoint with client integration and tests |
| L | 8-15 files | 1-2 days | Implement a complete workflow across UI, API, persistence, and tests |
| XL | More than 15 files | Multi-day | Replace an authentication flow or migrate a shared data model — should be split |

Use sizing to protect flow. A task that is too large hides risk and makes progress hard to verify.

## Part 2: When To Break A Task Down Further

Break a task down when:

- You cannot describe acceptance criteria in 3 bullets.
- It touches two independent subsystems.
- The title contains "and."

A good task has one primary outcome, one review surface, and a clear definition of done.

## Part 3: Slicing Strategies

### Risk-First Slicing

Tackle the highest-risk piece first. Prove the uncertain part before investing in dependent work.

Use this when the risk is technical feasibility, unknown performance, unfamiliar integration, data migration, or a hard product constraint. The goal is to fail fast while the cost of changing direction is still low.

### Contract-First Slicing

Define the shared contract first, then let backend and frontend work against it in parallel.

Use mock data, typed schemas, API examples, or fixture responses so each side can move independently. Integrate against the real implementation after both sides satisfy the contract.
