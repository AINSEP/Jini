# Authored checkbox values (owner follow-up, 2026-10-04)

`FieldDescriptor.checkboxValue` records the presence of an authored value attribute, including
the empty string. Such fields accept and persist scalar posted strings; boxes without it keep
the existing native `on` → true and JSON boolean contract. Omitted required controls fail.
Persistence remains string/boolean JSON; no schema change. HTML parsing remains a host adapter.
