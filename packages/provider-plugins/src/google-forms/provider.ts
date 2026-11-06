import type { FormCollectionProvider, FormCollectionPlan } from '@jini-ai/cms/forms';

const capabilities = {
  answers: 'Questions and answers are managed in Google Forms; new answers are not copied into the built-in inbox.',
  validation: 'Google Forms validates its own questions; local form fields do not change the embedded form.',
  spamProtection: 'Google Forms provides its own submission controls according to the form owner’s settings.',
};

/** Public Google Forms embeds use no SDK, credentials, Google API calls or local answer copies.
 * A valid link cannot prove publication or responder access; the visible alternative remains useful.
 * @complexity O(1) construction; planning is O(url bytes + config keys) time, O(url bytes) space, no I/O. */
export function createGoogleFormsProvider(_required: Record<string, never>, _optional: Record<string, never> = {}): FormCollectionProvider {
  return {
    describe: () => ({
      label: 'Google Forms', fields: [{ key: 'url', label: 'Public form link', type: 'url', helpText: 'Use the published https://docs.google.com/forms/d/e/form-id/viewform link.' }],
      helpText: 'Publish the form, allow public responders, and verify its link in an anonymous browser before selecting it.',
      answers: capabilities.answers, validation: capabilities.validation, frameOrigins: ['https://docs.google.com'],
    }),
    plan({ config }): FormCollectionPlan {
      const url = config.url ?? '';
      const match = /^https:\/\/docs\.google\.com\/forms\/d\/e\/([A-Za-z0-9_-]+)\/viewform(?:\?(?:embedded=true|usp=[A-Za-z0-9_-]+))?$/.exec(url);
      // Comparing the entire match also rejects trailing line breaks accepted by JavaScript's $ anchor.
      if (Object.keys(config).length !== 1 || !match || match[0] !== url) {
        return { kind: 'unavailable', code: 'invalid_configuration', message: 'This form needs a published public Google Forms link (https://docs.google.com/forms/d/e/form-id/viewform) before it can collect answers.' };
      }
      const publicUrl = `https://docs.google.com/forms/d/e/${match[1]}/viewform`;
      return { kind: 'embed', url: `${publicUrl}?embedded=true`, publicUrl, title: 'Google Forms', consent: ['functional'], capabilities,
        fallbackMessage: 'If this form does not open, open it on Google or contact the site owner.' };
    },
  };
}
