# Property-Based Testing

Example-based tests verify specific inputs. Property-based tests verify that a property holds across a large range of automatically generated inputs.

## When to Use Property Tests

- ACs involving ranges, bounds, or numeric computation, such as `total must never be negative`
- Input validation logic, such as `any string over 255 chars must be rejected`
- Collections: sorting, deduplication, and ordering invariants
- Parsers, serializers, and encoders with round-trip guarantees
- Business logic invariants that must hold regardless of input shape

## When to Stay With Example Tests

- Happy path and named failure scenarios
- Behavior defined by a fixed contract, such as HTTP status codes or exact error messages
- Integration and acceptance tests that need concrete, readable examples

## Deriving a Property From an AC

| AC Pattern | Property to Test |
|---|---|
| `total equals sum of line items` | For any set of line items, `total === sum(items.map(i => i.price * i.qty))` |
| `quantity must be positive` | For any quantity `<= 0`, the system rejects with a validation error |
| `idempotent submission` | For any valid request, submitting it twice returns the same result |
| `no partial writes on failure` | For any input that triggers a failure, the database state is unchanged |

## Recommended Libraries

- TypeScript/JavaScript: `fast-check`
- Python: `Hypothesis`

## Certification Record Example

```md
Property Tests:
- INV-01 (invoice total invariant): fast-check property test (see tests/properties/invoice-total.property.ts)
- EC-01 (quantity validation): Hypothesis strategy test (see tests/properties/quantity.property.py)
```
