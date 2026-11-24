import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** deployments registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "deployment_get_static_publish_status": {
    search: { keywords: "publish deployment job progress timeout finished uploaded files did it land status result" },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_execute_static_publish": {
    summary: 'This publishes the current site to the selected hosting project.',
    title: 'Publish static site',
    actionVerb: 'Publish',
    search: {
      keywords: "deploy push ship go live make it live publish the site hosting static host custom domain apex www dns",
      queries: ["Publish the site.", "Publish the site to production hosting.", "Deploy this website and make it live.", "Push my site live on my static host."],
    },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  "deployment_generate_bucket_hosting_setup": {
    search: {
      keywords: "instructions steps how to setup guide public website cloud storage host",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_get_dockerfile": {
    search: {
      keywords: "docker container read view current build file",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_diagnose_static_export": {
    search: {
      keywords: "diagnose static export dropped references missing pages assets forms failures before publish refused deployment",
      queries: ["What would a static export drop?", "Why was my static publish refused?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_get_export_status": {
    search: {
      keywords: "progress done finished check static site build",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- deployments / static publish -----------------------------------------------------------------------
  // Readiness wording and actual hosting targets keep publication distinct from observation tools.
  "deployment_get_static_publish_capabilities": {
    search: {
      keywords: "can I publish yet ready deploy hosting connected status providers hosts where static host",
      queries: [
        "Which static publishing hosts are available?", "Can this site publish to my hosting provider?", "Where can I publish a static site?", "Which hosting credentials are connected?",
        // Questions express publication readiness rather than backstop-gap inspection.
        "Is my site ready to publish yet?", "Can I publish my site yet, or is hosting not set up?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_preview_static_publish": {
    search: {
      keywords: "dry run check before deploy publish what would happen what will be published test authenticated hosting preview domain dns records bindings routes conflicts",
      // Questions phrase the operator's pre-publish check; without them that phrasing ranked this
      // read 4th, behind the draft-preview and template-reload tools.
      queries: [
        "Check what gets published before I deploy the site.",
        "Dry-run publishing my site without uploading anything.",
        "Which hosting and domain changes would a publish make?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_set_dockerfile": {
    search: {
      keywords: "docker container write edit update change build file",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "deployment_trigger_export": {
    search: {
      keywords: "build generate export files download self host static site",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
