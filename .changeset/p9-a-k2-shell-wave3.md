---
"@jini-ai/admin": minor
---

More admin shell moves on the injected kit (A-K2-shell-lib-1/2, A-K2-shell-components-1/2 slices): `shell/lib/{stream-activity,assistant-prompt-bus,browser-stream,credential-card-guidance,admin-nav-i18n}` and `shell/components/{AssistantDock/local-cli-selection-echo, AssistantDock/MessageOverflowModal.hooks, AssistantDock/SlowRunNoticeCard.hooks, AssistantDock/hooks/use-assistant-empty-state.hooks, CodeView/preview-modal-icons, InstallTabCard/use-folder-upload.hooks, Select/Select.hooks}`. Their UI/chat imports now read the admin kit. Two take an injected collaborator: `isSelectionNormalizationEcho` needs `resolveChatPaneSelection` in its args, and `useFolderUpload` needs a `folderZip` port (`FolderZipPort`). `admin-nav-i18n` reads the shared `ADMIN_COMMON_I18N` dictionary.
