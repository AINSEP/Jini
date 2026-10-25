---
"@jini-ai/platform": patch
"@jini-ai/cms": patch
---

Add vendor-neutral email sender contracts, source discovery and template preparation to the mail
surface, with a universal `@jini-ai/platform/mail/senders` entry. Add the Forms sender to
`@jini-ai/cms/forms/email-sender`, deriving tokens from stable field IDs, resolving authorized submissions and
permitted recipients, and configuring sender-owned email actions through an injected guarded writer.
Delivery planning and production readiness remain host responsibilities.
The dedicated sender entry requires the optional platform peer at ^0.6.15; the existing Forms
entry continues to load without platform installed.
