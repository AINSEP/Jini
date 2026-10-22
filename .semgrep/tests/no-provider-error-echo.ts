import { redactSecrets } from '@jini-ai/core';

async function thrownMessage() {
  try { await provider.request(); } catch (error) {
    // ruleid: no-provider-error-echo
    throw new Error(`Provider failed: ${error.message}`);
  }
}
async function returnedBody() {
  try { await importer.run(); } catch (error) {
    const detail = error.body;
    // ruleid: no-provider-error-echo
    return { message: 'Import failed: ' + detail };
  }
}
async function returnedString() {
  try { await provider.request(); } catch (error) {
    // ruleid: no-provider-error-echo
    return String(error);
  }
}
async function loggedBody() {
  try { await importer.run(); } catch (error) {
    // ruleid: no-provider-error-echo
    logger.warn({ message: error.response.body });
  }
}
async function rejected() {
  return provider.request().catch(error => {
    // ruleid: no-provider-error-echo
    throw new Error(error.message);
  });
}
async function safeStatus() {
  try { await provider.request(); } catch (error) {
    // ok: no-provider-error-echo
    throw new Error('Provider request failed');
  }
}
async function safeCode() {
  try { await importer.run(); } catch (error) {
    // ok: no-provider-error-echo
    return { message: 'Import failed', code: 'IMPORT_FAILED' };
  }
}
async function redactedLog() {
  try { await provider.request(); } catch (error) {
    // ok: no-provider-error-echo
    logger.warn(redactSecrets({ input: error.message }));
  }
}
