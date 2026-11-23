---
"@jini-ai/core": patch
---

Add three host-neutral site contracts, each an additive copy of declarations its owning package keeps until the paired cutover. `./contracts/site/user-management-react` (`UsersPort`, `RolesPort`, `MembersPort`, `TotpSettingsPort`, `PasskeySignInPort`, `PasskeySettingsPort` and their DTOs) copies `@jini-ai/user-management/react`'s ports; the React screen controllers stay there. `./contracts/site/cookie-consent` (`ConsentState`, `ConsentConfig`, `ConsentAnalyticsProof`, `RawContribution`, `RegionResolver`, `DeclaredScript` and their vocabulary) copies `@jini-ai/cookie-consent`'s contract types. `./contracts/site/cms-forms` (`FormDeliveryJobStatus`, `FormDeliveryBinding`, `FormDeliveryConnectionPort`, `FormDestinationCredential`, `FormDestinationForm`, `FormSubmissionsInspection`, `FormDestinationPublishInput`, `FormReceiverPlan`, `FormReceiverPort`, `FormDefinitionRepoPort` and their closure) copies `@jini-ai/cms/forms`' shapes.
