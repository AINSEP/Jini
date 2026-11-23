import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** deploy-ops registration declarations; shared placement rationale is in the host aggregator.
 * The site-key secret's env var name is host-owned search vocabulary, so the host passes it in
 * (`siteKeyEnvName`) and the package never names one. */
export function createDeployOpsToolMetadata({ siteKeyEnvName }: { siteKeyEnvName: string }, _optional: Record<string, never> = {}) {
  return {
  "deployment_ops_deploy": {
    title: 'Deploy your app',
    summary: 'This starts a deployment of the selected app on its hosting service.',
    search: {
      keywords: "deploy now redeploy ship release roll out push the server app to production start a deploy actions workflow dispatch latest commit main",
      queries: [
        "Deploy the server now.", "Redeploy my app to production.", "Ship the latest commit on main to the host.", "Start a deploy through deployment workflow.",
      ],
    },
    approval: { class: 'publish', confirmation: 'policy' },
  },
  "deployment_ops_list_secrets": {
    search: {
      keywords: "list secrets environment variables env vars which secrets are set on my app server host names digests",
      queries: [
        "Which secrets are set on my hosted app?", "List the environment variables on the server.", `Is ${siteKeyEnvName} set in production?`, "Show my app's secrets.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_ops_list_targets": {
    search: {
      keywords: "list my apps which apps do I have deployments",
      queries: [
        "List my hosted apps.", "Which apps do I have on my host?", "Show available deployment targets.", "What hosted apps can you inspect?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_ops_logs": {
    search: {
      keywords: "logs log output error why did deploy fail build failed crash actions",
      queries: [
        "Why did the deployment workflow fail?", "Show the error logs from my hosted app.", "What failed steps explain the build error?", "Read deployment logs for this crash.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_ops_set_secret": {
    title: 'Set this hosting secret',
    summary: 'This adds or replaces the selected secret on the hosted app.',
    search: {
      keywords: "set secret API_KEY on my app add environment variable env var copy site key to host server rename secret copy secret stage",
      queries: [
        `Set ${siteKeyEnvName} on my host from my site key.`, "Copy the site key to the production server.", "Add a secret to my hosted app.", "Copy one secret to a new name on the host.",
      ],
    },
    approval: { class: 'replace-secret', confirmation: 'plan' },
    mcpUi: { secretField: { secret: true } },
  },
  "deployment_ops_status": {
    search: {
      keywords: "deploy deployment status is my app up running healthy machines actions workflow run build ci passed failed",
      queries: [
        "Is my hosted app healthy?", "Is my hosted app up?", "Did the deployment workflow build pass?", "Show deployment status for my running app.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "deployment_ops_unset_secret": {
    title: 'Remove this hosting secret',
    summary: 'This removes the selected secret from the hosted app and may affect its operation.',
    search: {
      keywords: "unset secret remove delete environment variable env var old secret from host server app",
      queries: [
        "Remove the old secret from the host.", "Unset an environment variable on my server.", "Delete the OLD_API_KEY secret from production.", "Remove a secret from my hosted app.",
      ],
    },
    approval: { class: 'replace-secret', confirmation: 'plan' },
  },
  "deployment_ops_wait": {
    search: {
      keywords: "wait until deployed finished done poll check again in a minute",
      queries: [
        "Wait until the deploy finishes and tell me.", "Poll until my deployment is healthy.", "Check again in a minute until it is done.", "Wait for the deployment to finish.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
}
