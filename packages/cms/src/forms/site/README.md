# `@jini-ai/cms/forms/site/*` — site-runtime forms pieces

Small site-side forms modules a host composes into its public submit path and admin wiring.

| file | holds |
| --- | --- |
| `rate-limit-profile.ts` | `FORMS_SUBMIT_PROFILE` — the fixed-window profile for anonymous submissions. |
| `analytics-provenance.ts` | `FormAnalyticsProvenance` — the consent evidence shape attached to accepted submissions. |
| `form-file-storage.ts` | `createFormFileStorage` — binds the media service into the forms file-storage port (sniff, store, discard). |
| `form-destination-manifest.ts` | Destination manifest builders. |
| `import-remote-submissions.ts` | Remote submission import. |
| `mail-outbox-readiness.ts` | Whether the mail outbox lane is ready. |

## Wiring

- The host owns the rate limiter: it builds `createRateLimiter({ profile: FORMS_SUBMIT_PROFILE, clock })`
  and injects it into its forms route deps. This package only pins the profile constant.
- The host's consent layer builds a `FormAnalyticsProvenance` and passes it into the submit path; this
  package only defines the shape (the proof type is `@jini-ai/core/contracts/site/cookie-consent`).
- `createFormFileStorage({ media, contentTypes, resolveCreatedByPrincipal })`: the host injects its media
  deps (repos, blob store, clock, id generator), its content-type store, and the resolver that names the
  system principal anonymous uploads are attributed to.
