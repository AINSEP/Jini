---
"@jini-ai/admin": patch
---

More admin shell moves (w4-admin-shell): `shell/components/TemplateSource/ViewTemplateButton`, `shell/hooks/use-desktop-view-release.hooks`, `shell/hooks/assistant-chats-port.hooks`, `shell/components/AssistantDock/{chat-agent-plugin-preferences, SubagentsIndicator, hooks/use-chat-agent-plugins.hooks, hooks/use-assistant-runtime-preferences.hooks, hooks/use-selected-agent-auth-warning.hooks, hooks/chat-package-kind, hooks/conversation-refresh.hooks}`, `shell/components/MediaEditDialog/MediaEditDialog.hooks`, `shell/lib/{agent-screenshot, live-tiptap-editor, media-image-extension.hooks, media-embed-extension.hooks}`. Host collaborators arrive as required fields (settings namespace/defaults, legacy manifest names, chats port, detection-port factory, rasterizer, media translator and embed policy); `SubagentsIndicator` takes its settings hook as a required prop.
