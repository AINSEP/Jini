import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** frontend-control registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "page.find_elements": {
    search: { keywords: "read this screen read admin UI page controls inspect current state show me discover buttons find elements open bring up go to navigate" },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "page.highlight": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  "page.scroll_to": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  // A click's effect is opaque. Reviewed ordinary install controls are direct; all other
    // clicks retain explicit consent, including every destructive final-dialog button.
  "page.click": {
    search: { keywords: "click activate open bring up show me inspect published handle admin UI" },
    title: 'Activate the selected control',
    summary: 'This activates the selected control in the admin interface and may make a permanent change.',
    approval: { class: 'delete', confirmation: 'policy', rule: 'page-control' },
  },
  "page.fill": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "page.select_option": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "page.navigate": {
    search: { keywords: "open bring up show me go to navigate navigation admin UI screen panel page editor take me" },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.send_message": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.set_draft": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.select_agent": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.cancel_run": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Local view reset keeps stored conversations/messages; it is not a delete.
  "chat.reset_conversation": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.set_working_directory": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "chat.get_state": {
    approval: { class: 'read', confirmation: 'direct' },
  },
  // Opens the Publish dialog; final submission remains a human control (plan §4 S3).
  "admin.publish_content": {
    search: {
      keywords: "publish publishing go live push to live deploy deployment content site update the live site overwrite " +
        "overwrite live replace what's on live make changes live send to production release ship pages posts " +
        "media menus redirects navigation " +
        // It is also the only way to see what is waiting to be published: it answers with the dialog's
        // plan and publishes nothing until the person confirms there.
        "pending unpublished changes changed not yet published what would be published preview " +
        "review before publishing without publishing dry run " +
        // Questions distinguish unpublished changes from previewing a draft.
        "hasn't haven't been published yet",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- agent-driven admin screen capture --------------------------------------------------------------
  "admin.capture_screenshot": {
    search: {
      keywords: "screenshot screenshots screen capture picture image photo see view look looks looking visual visually appearance " +
        "layout broken cramped misaligned overlapping clipped cut off ugly render rendering rendered how does this look " +
        "what does this look like show me the screen check the ui verify visually",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
