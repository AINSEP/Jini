---
"@jini-ai/user-management": minor
---

Mail screen views move into `@jini-ai/user-management/react/mail`, with every host piece injected through typed props:

- `./react/mail/Email` — `Email`, `EmailProps`.
- `./react/mail/EmailProviderTab` — `EmailProviderTab`, `EmailProviderTabProps`, `shownProviderId`, `segmentLabel`, `ADD_PROVIDER_PART`, `CAPABILITIES_PART`.
- `./react/mail/EmailTemplateEditor` — `EmailTemplateEditor`, `EmailTemplateEditorProps`, `editorStatus`, `EmailTemplateEditorControl`, `EmailTemplateViewControl`, `EmailTemplateEditorKit`, `EmailTemplateEditorHooks`, `EmailTemplateEditorCopy`, `EmailTemplateTab`, `EmailPreviewMode`.
- `./react/mail/email-view.types` — `EmailTypes`, `EmailTabHooks`, `EmailParts`, `EmailKit`, `EmailRules`, `EmailCopy`, `EmailNavigate`, `EmailThemeBoundaryHook`, `EmailStatusControl`, `EmailStatusView`, `EmailStatusShape`, `EmailProviderControl`, `EmailProviderView`, `EmailProviderField`, `EmailProviderChoice`, `EmailCredentialKey`, `EmailLoadView`, `EmailLoadedProps`, `EmailTabBarProps`, `EmailSegmentedProps`, `EmailSummary`, `EmailTabId`, `EmailTone`, `EmailTranslate`.
