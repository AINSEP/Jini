---
name: tool-design
version: 1.0.0
last_updated: 2026-02-22
description: Use when designing agent tools, writing tool descriptions, applying the consolidation principle, designing error messages, or building MCP tools.
---

# Skill: Tool Design

Tools are the interface between agents and the world. A well-designed tool does exactly what the agent needs, fails clearly when it cannot, and does not require the agent to understand its internals. Poorly designed tools are the leading cause of agent failure that looks like a model capability problem.

## The Consolidation Principle

Prefer fewer, broader tools over many narrow ones.

**Wrong**: `get_invoice_by_id`, `get_invoice_by_number`, `get_invoice_by_customer`, `list_invoices`, `search_invoices`

**Right**: `query_invoices({ filters: {...}, options: { limit, offset, orderBy } })`

Why: Each tool call consumes attention. An agent deciding which of 12 similar tools to use is using reasoning capacity that should go to the actual problem. One tool with expressive parameters is cheaper to reason about than five tools with overlapping semantics.

Threshold: If two tools share 80% of their parameters, merge them.

## Tool Description Engineering

The tool description is prompt engineering. Agents read descriptions to decide when and how to call a tool. A bad description produces wrong calls; a good description produces correct ones.

Structure every tool description around four questions:

1. **What does this tool do?** — One precise sentence. No vague verbs ("handles", "manages", "deals with").
2. **When should the agent call it?** — Explicit conditions. Include "not when" if there is a natural confusion.
3. **What does it return?** — Describe the return shape, not just the type.
4. **What can go wrong?** — List failure cases the agent needs to handle.

```typescript
// WRONG description
description: "Gets invoice data"

// RIGHT description
description: `Retrieves invoice records matching the given filters.
Call when you need to look up one or more invoices by any combination of ID,
customer, status, or date range. Do NOT call to check if an invoice exists
before creating one — use createInvoice with an idempotency key instead.
Returns: array of InvoiceView objects (empty array if no matches, never null).
Throws: InvoiceServiceUnavailableError if the invoice service is down.`
```

## Error Message Design for Agent Recovery

When a tool fails, the error message is context the agent uses to decide what to do next. Generic errors produce hallucinated recovery attempts. Specific errors produce correct ones.

**Wrong**:
```
Error: Request failed
Error: 500 Internal Server Error
Error: Invalid input
```

**Right**:
```
CustomerNotFoundError: No customer with ID "cust-999" exists.
  Verify the customer ID from the spec or caller input before retrying.

ValidationError: lineItems[2].amount must be a positive number, got -50.
  Fix the input value and retry. This error will not resolve on retry without input change.

PaymentServiceUnavailableError: Payment service unreachable after 3 attempts.
  This is a transient infrastructure failure. Retry with exponential backoff.
  If it persists after 5 minutes, escalate to human.
```

Each error should tell the agent: what went wrong, why, and what to do.

## Parameter Design

Apply the two-object paradigm consistently (see `<ADS_MEMORY_ROOT>/knowledge/project_notes.md`):
- First argument: required parameters
- Second argument: optional parameters with defaults

For tools with many optional filters, use a structured options object rather than individual parameters.

**Avoid boolean flags that change behavior**. `processPayment({ amount }, { dryRun: true })` is fine. But `processPayment({ amount }, { mode: 'charge' | 'refund' | 'void' })` should be three separate tools — they have different required parameters, different return shapes, and different failure modes.

## Response Format Optimization

Return exactly what the agent needs, not everything available.

**Verbose response** (forces agent to extract signal from noise):
```json
{ "invoice": { "id": "INV-001", "created_at": "...", "updated_at": "...",
  "internal_ref": "...", "audit_log": [...], "customer": { ...full object... },
  "line_items": [...full objects...], "status": "paid", ... } }
```

**Optimized response** (for a "did this invoice get paid?" query):
```json
{ "invoiceId": "INV-001", "status": "paid", "paidAt": "2026-02-15T14:23:00Z" }
```

Design responses for the most common use case of that tool. Add a `verbose: true` option for cases where the full object is genuinely needed.

## MCP Tool Naming Conventions

When publishing tools as MCP servers, prefix with the server name to prevent namespace collisions:

```
invoices_create_invoice      ✓
invoices_query_invoices      ✓
create_invoice               ✗ (collides if another server has create_invoice)
```

Format: `{server_name}_{action}_{resource}` in snake_case.

## Host-Side Approval for External Tools

Apply one host-owned approval policy to third-party MCP, integration, and plugin tools the host does not control; never require a plugin or connection to opt its tools into confirmation.

- Server-marked read-only tools run without an approval card. Every other external call (write, destructive, or unannotated) requires a per-call card showing the exact arguments before execution, unless covered by a valid remembered approval.
- Card buttons: **Allow / Allow for this chat / Always allow / Cancel**. Destructive tools never offer **Always allow**.
- Store **Always allow** per host + connection + tool in host settings, never in plugin content; make it revocable.
- Remote hints may only add friction, never relax the host's approval decision. Keep the per-tool enable/disable list independent of approvals.

## Tool Testing Pattern

Before deploying a tool in a multi-agent system, test it with an agent:

1. Give a test agent only the tool and a task that requires it
2. Observe: does the agent call the tool with correct parameters on the first try?
3. If not: the description is unclear, the parameter names are misleading, or required vs optional is ambiguous
4. Iterate on the description until first-try accuracy is high

This is the only reliable way to validate tool descriptions. Static review misses the agent perspective.

## When Not to Use a Tool

Not every operation needs a tool. Agents should not call tools when:

- The information is already in context (do not re-fetch what was just returned)
- The operation can be done with reasoning (simple calculations, string formatting)
- The tool would be called just to validate what the agent already knows

Unnecessary tool calls increase latency, cost, and the chance of errors. Design tools with a "cache result in context and don't re-call" assumption.

## Inline Documentation Requirement

All tools and functions generated using this skill must include language-appropriate inline documentation. Undocumented generated code is incomplete output — it is not acceptable to ship a tool function without documentation any more than it is acceptable to ship a tool without a description.

**TypeScript / JavaScript** — TypeDoc / JSDoc:
```typescript
/**
 * Retrieves invoice records matching the given filters.
 *
 * @param filters - Query criteria: one or more of invoiceId, customerId, status, dateRange.
 * @param options - Optional query configuration.
 * @param options.limit - Maximum number of records to return. Defaults to 20.
 * @param options.offset - Number of records to skip for pagination. Defaults to 0.
 * @param options.orderBy - Sort field and direction. Defaults to { field: 'createdAt', direction: 'desc' }.
 * @returns Array of InvoiceView objects matching the filters. Empty array if no matches. Never null.
 * @throws {InvoiceServiceUnavailableError} If the invoice service cannot be reached after 3 attempts.
 * @example
 * const invoices = await queryInvoices({ customerId: 'cust-001' }, { limit: 10 });
 */
```

**Python** — Google or NumPy style docstrings:
```python
def query_invoices(filters: InvoiceFilters, options: QueryOptions | None = None) -> list[InvoiceView]:
    """Retrieve invoice records matching the given filters.

    Args:
        filters: Query criteria — one or more of invoice_id, customer_id, status, date_range.
        options: Optional query configuration (limit, offset, order_by).

    Returns:
        List of InvoiceView objects. Empty list if no matches. Never None.

    Raises:
        InvoiceServiceUnavailableError: If the invoice service cannot be reached after 3 attempts.

    Example:
        invoices = query_invoices(InvoiceFilters(customer_id='cust-001'), QueryOptions(limit=10))
    """
```

**Other languages** — use the equivalent idiomatic format (Rustdoc, Javadoc, XML doc comments for C#, etc.).

Every tool-related function must document:
- **Purpose**: what the function does, precisely
- **Parameters**: name, type, and meaning for every parameter (including optional ones and their defaults)
- **Return value**: type and shape of what is returned, including null/undefined/empty cases
- **Error conditions**: every exception or error type that can be thrown, and what causes it
- **Example usage**: at least one concrete call with realistic values

This applies to: tool wrapper functions, helper utilities, parameter validation functions, response transformation functions, and any other generated code — not only the top-level tool function.

## Common Failure Modes

**Too many overlapping tools**: Agent cannot decide which tool to use for a given task. 12 invoice tools where 3 would suffice. Audit and merge.

**Vague descriptions**: "Manages invoice state" — does this create? update? delete? transition status? Write what it does, not what it is.

**Silent failures**: Tool returns empty array instead of an error when the underlying service is down. Agent interprets no results as "nothing found" and hallucinates a conclusion. Tools must fail loudly on infrastructure errors.

**Missing "not when" guidance**: Agent calls `create_invoice` when it should call `update_invoice` because the description didn't say when NOT to create. Include exclusions for tools with non-obvious boundaries.

**Return shape that requires post-processing**: Tool returns a list of 50 fields and the agent uses 3 of them. Every unused field costs attention. Slim the response.
