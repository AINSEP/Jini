---
"@jini-ai/core": patch
---

URL parameters that carry a one-time or activation code (`activation_code`, `verification_code`, `reset_code`, `auth_code`, `otp`, `invite_code`, ...) are masked again. The parameter NAME set is matched, not any name ending in `code`, so `zipcode`, `promo_code` and `error_code` keep their values.
