import { redactSecrets } from '@jini-ai/core';
import { redactText } from '@jini-ai/diagnostics';
import { redactSecretShapes } from '@jini-ai/diagnostics/redaction/secrets-only';

async function unsafeLogs() {
  try { await provider.request(); } catch (error) {
    // ruleid: log-raw-error
    console.error(error.message);
    // ruleid: log-raw-error
    logger.warn(`Import failed: ${String(error)}`);
    const detail = error.message;
    // ruleid: log-raw-error
    logger.error({ detail });
    // Redacting one argument must not hide another raw argument.
    // ruleid: log-raw-error
    logger.error(redactSecrets({ input: error.message }), error.message);
    // An arbitrary helper name does not establish the canonical redaction contract.
    // ruleid: log-raw-error
    logger.error(redactProviderError(error.message));
  }
}
async function safeLogs() {
  try { await importer.run(); } catch (error) {
    // ok: log-raw-error
    console.error('Import failed');
    // ok: log-raw-error
    logger.warn(redactSecrets({ input: error.message }));
    // ok: log-raw-error
    logger.error(redactText({ text: String(error) }));
    const safe = redactSecretShapes({ text: error.message, policy: {} }).text;
    // ok: log-raw-error
    logger.info(safe);
  }
}
async function rejected() {
  return provider.request().catch(error => {
    // ruleid: log-raw-error
    logger.error(String(error));
  });
}
