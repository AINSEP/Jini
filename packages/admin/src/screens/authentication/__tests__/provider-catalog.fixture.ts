import type { AuthenticationProviderSchema } from "../model/provider-schemas.js";

/** A host provider catalog, as the host binds it (fixture copy of a real host's catalog). */
export const PROVIDER_CATALOG_FIXTURE: readonly AuthenticationProviderSchema[] = [
  {
    id: "google",
    label: "Google",
    subtitle: "OAuth client credentials for Google sign-in.",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        kind: "text",
        placeholder: "1234567890-example.apps.googleusercontent.com",
        hint: "OAuth 2.0 Web application client ID from Google Cloud Console.",
        required: true,
      },
      {
        key: "clientSecret",
        label: "Client secret",
        kind: "password",
        placeholder: "Enter Google client secret",
        hint: "OAuth 2.0 client secret paired with the client ID.",
        required: true,
      },
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    subtitle: "OAuth app credentials for Facebook sign-in.",
    fields: [
      {
        key: "appId",
        label: "App ID",
        kind: "text",
        placeholder: "Enter Meta app ID",
        hint: "Application ID from Meta for Developers.",
        required: true,
      },
      {
        key: "appSecret",
        label: "App secret",
        kind: "password",
        placeholder: "Enter Meta app secret",
        hint: "Application secret paired with the app ID.",
        required: true,
      },
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    subtitle: "OAuth client credentials for LinkedIn sign-in.",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        kind: "text",
        placeholder: "Enter LinkedIn client ID",
        hint: "OAuth 2.0 client ID from the LinkedIn developer application.",
        required: true,
      },
      {
        key: "clientSecret",
        label: "Client secret",
        kind: "password",
        placeholder: "Enter LinkedIn client secret",
        hint: "OAuth 2.0 client secret paired with the client ID.",
        required: true,
      },
    ],
  },
] as const;
