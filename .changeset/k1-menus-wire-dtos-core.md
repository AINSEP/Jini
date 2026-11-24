---
"@jini-ai/core": patch
"@jini-ai/cms": minor
---

The admin menus wire DTOs (`AdminMenuDto`, `AdminMenuItemDto`, the target/attrs unions and the list, assign-location and trash envelopes) are declared once in `@jini-ai/core/contracts/site/cms-menus`, so an admin client reads the same shapes without depending on CMS. `@jini-ai/cms/admin-http/http/menus` keeps only the serializers and no longer exports the DTO types. **Breaking (cms):** the serializers and parsers take object arguments — `toAdminMenuDto({ menu })`, `toAdminMenuResponse({ menu })`, `toAdminMenuBindingDto({ binding })`, `parseMenuHtmlAuthoring({ body })`. The menus `update-tree` spec omits `entityId` on the raw-HTML check when the parsed menu id is empty, as the hand-written route did. Wire bodies are unchanged.
