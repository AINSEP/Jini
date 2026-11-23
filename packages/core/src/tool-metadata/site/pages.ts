import type { ToolMetadataById } from "../../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../../contracts/site/tool-metadata-approval-policy.js";

/** pages registration declarations; shared placement rationale is in the host's tool-metadata catalog index. */
export const toolMetadata = {
  // Movers use order/position vocabulary only; edit verbs belong to section writers.
  "pages_move_region": {
    guidanceCapabilities: ["theme-authoring", "ui-design"],
    search: {
      keywords: "move moving reorder reordering rearrange rearranging reposition order ordering sequence position swap places above below before after higher lower up down earlier later top bottom first last",
      queries: [
        "Swap the order of two sections on our landing page.",
        "Move the testimonials above the pricing on this page.",
        "Move the FAQ after the hero or before the footer.",
        "Rearrange the blocks on this page into a different order.",
        "Move the contact block up to first position.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Opposed whole/entire/rewrite vs one/section vocabulary distinguishes full-body writes
  // from section edits. Questions keep those contracts apart as well.
  "pages_read_html": {
    search: {
      // Index the read result, not a later edit: prerequisite wording otherwise competes with writers.
      keywords: "page html source code view read existing content current markup body regions region handles sections what is on the page show current version",
      queries: [
        "What HTML is on this page right now?",
        "Show the current markup and body content for the page.",
        "List this page's editable regions.",
        "Read the section handles available in the page HTML.",
        "Return the current page version number.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "pages_write_html": {
    guidanceCapabilities: ["theme-authoring", "ui-design"],
    search: {
      keywords: "custom page html code write create new design page build a page landing page whole entire full complete rewrite rewriting redo start over from scratch replace the page restructure add a section remove a section",
      queries: [
        "Build me a landing page for our new product.",
        "Replace this page's whole body with a completely new design.",
        "Start this page over from scratch — throw away what's there.",
        "I want to restructure the page and add two new sections.",
        "Create the full HTML for a bespoke page on our site.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "pages_write_region": {
    guidanceCapabilities: ["theme-authoring", "ui-design"],
    search: {
      keywords: "section sections region regions part parts piece block chunk area one single just the only the " +
        "hero headline heading title banner cta call to action pricing faq testimonial footer text copy " +
        "edit editing change changing update updating tweak adjust revise reword swap replace fix amend " +
        "without rewriting not the whole page leave the rest keep the rest surgical targeted in place " +
        "handle data-agent-element",
      queries: [
        "Just change the headline on our landing page, leave the rest alone.",
        "Update the pricing section of this page without touching anything else.",
        "Can you reword the call to action but keep the page as it is?",
        "Edit one section of a page without rewriting it.",
        "I want to edit just the hero copy on this page and nothing more.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
