import type { AdminPublishTargetDescriptor } from "../../deployment/api/deployment-api.types.js";

/**
 * @file The deploy registry's targets as `GET .../system/publish-targets` returns them — a copy of
 * the shape each hosting plugin's `content/agent-plugins/<id>/jini-deploy-targets.json` produces, for the admin's unit
 * tests. The admin itself names no host: every label, field and help string below reaches the UI
 * only through this response.
 */

const TOKEN = { name: "token", label: "Access token", required: true, secret: true as const };

export const GITHUB_PAGES_TARGET: AdminPublishTargetDescriptor = {
  id: "github-pages",
  label: "GitHub Pages",
  configFields: [
    {
      name: "owner",
      label: "Owner",
      required: true,
      help: "Default it to the verified account and confirm it; never guess it.",
      userHelp: "The GitHub user or organization that owns the repository.",
    },
    { name: "repo", label: "Repository", required: true, help: "The site is served from /<repository>." },
    { name: "branch", label: "Branch", required: false, help: "Defaults to gh-pages." },
  ],
  credential: {
    tokenField: "token",
    vendorLabel: "GitHub",
    tokenPageUrl: "https://github.com/settings/tokens",
    fields: [{ ...TOKEN, label: "Personal access token", help: "Needs write access to the repository's contents." }],
  },
  projectName: { label: "Commit message", help: "Used as the commit message on the gh-pages branch." },
};

export const VERCEL_TARGET: AdminPublishTargetDescriptor = {
  id: "vercel",
  label: "Vercel",
  configFields: [{ name: "teamId", label: "Team ID", required: false, help: "Only for a team account." }],
  credential: { tokenField: "token", tokenPageUrl: "https://vercel.com/account/tokens", fields: [{ ...TOKEN, help: "Vercel: Account settings > Tokens." }] },
  projectName: { label: "Vercel project name", help: "Vercel finds or creates a project with this name on every publish." },
};

export const NETLIFY_TARGET: AdminPublishTargetDescriptor = {
  id: "netlify",
  label: "Netlify",
  configFields: [],
  credential: { tokenField: "token", fields: [{ ...TOKEN, label: "Personal access token" }] },
  projectName: { label: "Site name", help: "Netlify finds or creates a site with this name on every publish." },
};

export const CLOUDFLARE_PAGES_TARGET: AdminPublishTargetDescriptor = {
  id: "cloudflare-pages",
  label: "Cloudflare Pages",
  configFields: [],
  credential: {
    tokenField: "token",
    vendorLabel: "Cloudflare",
    help: "Needs an API token with Cloudflare Pages Edit permission, plus the account ID.",
    tokenPageUrl: "https://dash.cloudflare.com/profile/api-tokens",
    fields: [
      { ...TOKEN, label: "API token" },
      { name: "accountId", label: "Account ID", required: true, help: "Shown on the Cloudflare dashboard's account home page." },
    ],
  },
  projectName: { label: "Project name", help: "Cloudflare Pages finds or creates a project with this name on every publish." },
};

/** A host with no saved credential and no config fields — proves the admin needs neither. */
export const PLAIN_TARGET: AdminPublishTargetDescriptor = { id: "plain-host", label: "Plain Host", configFields: [] };

export const PUBLISH_TARGETS: readonly AdminPublishTargetDescriptor[] = [GITHUB_PAGES_TARGET, VERCEL_TARGET, NETLIFY_TARGET, CLOUDFLARE_PAGES_TARGET];

/** The targets that take a saved credential, in registry order. */
export const CREDENTIAL_TARGET_IDS: readonly string[] = PUBLISH_TARGETS.filter((target) => target.credential !== undefined).map((target) => target.id);

import type { AdminSourceControlProviderDescriptor } from "../../source-control/api/source-control-api.types.js";
import { accessTokenProviders, type AccessTokenProviderCopy, type AccessTokenSourceControlHostInfo } from "../access-token-providers.js";

/**
 * @file The Access Tokens page's provider list as the hook builds it from a loaded deploy registry
 * and source-control host list — the deployment tests' fixture hosts, then three source-control
 * hosts (Bitbucket's form declares a required Username) — for this folder's tests.
 */
export const SOURCE_CONTROL_TEST_DESCRIPTORS: readonly AdminSourceControlProviderDescriptor[] = [
  {
    id: "github",
    label: "GitHub",
    credential: {
      tokenPageUrl: "https://github.com/settings/personal-access-tokens/new",
      help: "Needs a fine-grained personal access token scoped to just this repository, with Contents permission set to Read and write. A classic token with the \"repo\" scope also works, but reaches every repository this account can access — prefer the fine-grained token.",
      tokenField: "token",
      fields: [{ name: "token", label: "Access token", required: true, secret: true }],
    },
  },
  {
    id: "gitlab",
    label: "GitLab",
    credential: {
      tokenPageUrl: "https://docs.gitlab.com/user/project/settings/project_access_tokens/",
      help: "Needs a project access token.",
      tokenField: "token",
      fields: [{ name: "token", label: "Access token", required: true, secret: true }],
    },
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    credential: {
      tokenPageUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
      help: "Needs a Bitbucket API token.",
      tokenField: "token",
      fields: [
        { name: "token", label: "Access token", required: true, secret: true },
        { name: "username", label: "Username", required: true, userHelp: "The Bitbucket username this API token belongs to." },
      ],
    },
  },
];

/** English copy the generic logic is exercised with — the real host injects its own. */
export const COPY: AccessTokenProviderCopy = {
  categories: [
    { id: "all", label: "All" },
    { id: "source-control", label: "Source control" },
    { id: "hosting", label: "Hosting" },
    { id: "media", label: "Media" },
    { id: "ai", label: "AI" },
    { id: "ops", label: "Ops" },
    { id: "general", label: "General" },
  ],
  publishPurposeLabel: "Hosting",
  sourceControlPurposeLabel: "Source control",
  customScopeGuidanceKey: "Paste the access token this provider issued from its own dashboard.",
  customCredentialSubtitleKey: "Custom credential",
};

/** A test-side shaper from a plugin descriptor to its token-form facts (the host owns the real one). */
export function sourceControlProviderInfo(descriptor: AdminSourceControlProviderDescriptor): AccessTokenSourceControlHostInfo {
  const credential = descriptor.credential ?? { tokenField: "token", fields: [], tokenPageUrl: "", help: "" };
  const token = credential.fields.find((field) => field.name === credential.tokenField);
  return {
    id: descriptor.id,
    label: descriptor.label,
    tokenPageUrl: credential.tokenPageUrl ?? "",
    scopeGuidanceKey: credential.help ?? "",
    ...(token !== undefined ? { tokenLabel: token.label } : {}),
    fields: credential.fields.filter((field) => field.name !== credential.tokenField),
  };
}

/** The collaborators every {@link accessTokenProviders} call needs. */
export const HOST = { copy: COPY, sourceControlProviderInfo } as const;

export const ACCESS_TOKEN_TEST_PROVIDERS = accessTokenProviders({ publishTargets: PUBLISH_TARGETS, ...HOST }, { sourceControlProviders: SOURCE_CONTROL_TEST_DESCRIPTORS });
