# Admin extraction provenance

| Sheet | Destination | Source |
| --- | --- | --- |
| 107 | `src/security/react/live/Security.tsx` | Tovu `724ddc31a`, `apps/admin/src/features/security/Security.tsx:101–196` |
| 113 | `src/shell/lib/execution-settings-ledger.ts` | Tovu `724ddc31a`, `apps/admin/src/lib/execution-settings.ts:80–112,216–251,264–532`; host defaults and runtime binding retained |
| 115 | `src/react/settings/SettingsPageLayout.tsx` | Tovu `724ddc31a`, generic layout/tab/locale/About portions of `apps/admin/src/features/settings/SettingsUi.tsx:143–754`; tab bodies and host composition retained |

The existing Admin module-kit `SecurityPage` and Access Tokens UI remain available this wave. Sheet 107 adds the live slot-only shell with host-bound owner controls and domain panels. The owner requires a separate follow-up to retire the module-kit Access Tokens variant after the richer Integrations view is adopted.
