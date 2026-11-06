import type { FormCollectionProvider, FormCollectionPlan } from '@jini-ai/cms/forms';

/** Formspree collects a native browser POST. No SDK, credentials, vendor request or local answer copy.
 * @example createFormspreeProvider({}).plan({ slug: 'contact', config: { endpoint: 'https://formspree.io/f/abc123' } });
 * @complexity O(1) construction and space; each plan takes O(endpoint bytes + configuration keys), no I/O.
 * @overallScore 97 — Recommended: only public hosted Formspree endpoints are supported. */
export function createFormspreeProvider(_required: Record<string, never>, _optional: Record<string, never> = {}): FormCollectionProvider {
  return { describe: () => ({
    label: 'Formspree', fields: [{ key: 'endpoint', label: 'Public form endpoint', type: 'url', helpText: 'Use https://formspree.io/f/form-id from your Formspree form.' }],
    helpText: 'Send answers directly to your hosted Formspree form.',
    answers: 'Answers are managed in your Formspree account; they are not copied into the built-in inbox.',
    validation: 'Browser field checks and Formspree validation apply.', frameOrigins: [],
  }), plan({ config }): FormCollectionPlan {
    const endpoint = config.endpoint ?? '';
    // Exact allowlist prevents credentials, queries, fragments, alternate ports and path normalization.
    if (Object.keys(config).length !== 1 || !/^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(endpoint)) {
      return { kind: 'unavailable', code: 'invalid_configuration', message: 'This form needs a valid public Formspree endpoint (https://formspree.io/f/form-id) before it can send answers.' };
    }
    return { kind: 'post', action: endpoint, external: true, capabilities: {
      answers: 'Answers are sent directly to Formspree and are managed in your Formspree account; they are not copied into the built-in inbox.',
      validation: 'Browser field checks and Formspree validation apply; the built-in receiver does not validate these answers.',
      spamProtection: 'Formspree provides spam protection according to your Formspree account settings.',
    } };
  } };
}
