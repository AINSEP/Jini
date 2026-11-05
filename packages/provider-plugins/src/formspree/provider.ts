import type { FormCollectionProvider, FormCollectionPlan } from '@jini-ai/cms/forms';

/** Formspree collects a native browser POST. No SDK, credentials, vendor request or local answer copy.
 * @complexity O(1) construction; each plan checks its bounded public endpoint string. */
export function createFormspreeProvider(_required: Record<string, never>, _optional: Record<string, never> = {}): FormCollectionProvider {
  return { plan({ config }): FormCollectionPlan {
    const endpoint = config.endpoint ?? '';
    // Exact allowlist prevents credentials, queries, fragments, alternate ports and path normalization.
    if (Object.keys(config).length !== 1 || !/^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(endpoint)) {
      return { kind: 'unavailable', code: 'invalid_configuration', message: 'This form needs a valid public Formspree endpoint (https://formspree.io/f/form-id) before it can send answers.' };
    }
    return { kind: 'post', action: endpoint, external: true, capabilities: {
      answers: 'Answers are sent directly to Formspree and are managed in your Formspree account; they are not copied into this site.',
      validation: 'Browser field checks and Formspree validation apply; this site does not perform server validation.',
      spamProtection: 'Formspree provides spam protection according to your Formspree account settings.',
    } };
  } };
}
