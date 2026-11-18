---
"@jini-ai/core": patch
---

Two corrections to the new redaction rules. URL names that carry a credential stay masked as whole names (`code`, `code_verifier`, `device_code`, `session_code`, `verification_code`, `login_code`, `otp_code`) while names that only end in `code` keep their value. A quoted `Authorization` value (`"Token abc"`, `'Bearer two words'`) is again masked whole by the label rule instead of only its first word.
