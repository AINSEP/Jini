# Inline Documentation Examples

Use these as format references only. The rule itself lives in `agents/programmer/skills.md`.

## TypeScript / JavaScript

TypeDoc / JSDoc format:

```typescript
/**
 * Brief description of what the function does.
 *
 * @param customerId - The unique identifier for the customer record.
 * @param options - Optional query configuration.
 * @returns The matching InvoiceView, or null if not found.
 * @throws {CustomerNotFoundError} If no customer with the given ID exists.
 * @example
 * const invoice = await getInvoice('cust-001', { includeLineItems: true });
 */
```

## Python

Google or NumPy style docstrings:

```python
def get_invoice(customer_id: str, include_line_items: bool = False) -> Invoice:
    """Retrieve the most recent invoice for a customer.

    Args:
        customer_id: The unique identifier for the customer record.
        include_line_items: Whether to populate line item details. Defaults to False.

    Returns:
        The matching Invoice object.

    Raises:
        CustomerNotFoundError: If no customer with the given ID exists.
    """
```

## Other Languages

Use the equivalent idiomatic documentation format for the language in use, such as Rustdoc, Javadoc, or XML doc comments for C#.
