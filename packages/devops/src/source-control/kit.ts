import type { HttpClientPort } from '@jini-ai/core/primitives';
import { assertNotRedirected, redirectGuardInit } from '../core/redirect-guard.js';
import { DeployError } from '../core/deploy-types.js';
import type { DescribedTransportError, SourceControlFetchPort, SourceControlProviderKit } from './contracts.js';

/** Build a kit without globals or a silently missing guarded HTTP client. */
export function createSourceControlProviderKit(required: {
  httpClient: HttpClientPort;
  fetch: SourceControlFetchPort;
  describeTransportError(required: { error: unknown }): DescribedTransportError;
}): SourceControlProviderKit {
  return {
    fetch: ({ url, init }) => required.fetch({ url }, { init: redirectGuardInit({ init }) }),
    redirectGuardInit: ({ init }) => redirectGuardInit({ init }),
    assertNotRedirected: ({ response, hostName }) => assertNotRedirected({ resp: response, providerLabel: hostName }),
    isRedirectRefusal: ({ error }) => error instanceof DeployError,
    httpClient: required.httpClient,
    describeTransportError: input => required.describeTransportError(input),
  };
}

/** Adapt a host-selected native/guarded fetch without choosing a global transport. */
export function createSourceControlFetchAdapter(required: { fetch: typeof fetch }): SourceControlFetchPort {
  return ({ url }, optional = {}) => required.fetch(url, optional.init);
}
