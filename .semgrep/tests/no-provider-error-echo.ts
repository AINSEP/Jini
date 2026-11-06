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

async function rejectedAlias() {
  return provider.request().catch(failure => {
    const detail = failure.response.data;
    // ruleid: no-provider-error-echo
    return { message: detail };
  });
}
async function rejectedBodyText() {
  return provider.request().catch(failure => {
    // ruleid: no-provider-error-echo
    return failure.bodyText;
  });
}
async function rejectedString() {
  return provider.request().catch(failure => {
    // ruleid: no-provider-error-echo
    return String(failure);
  });
}
async function safeRejection() {
  return provider.request().catch(failure => {
    // ok: no-provider-error-echo
    return { message: 'Provider request failed', status: failure.status };
  });
}
async function redactedRejection() {
  return provider.request().catch(failure => {
    // ok: no-provider-error-echo
    return redactSecrets({ input: failure.message });
  });
}
async function successfulResponse() {
  return provider.request().then(response => {
    // ok: no-provider-error-echo
    return response.message;
  });
}

async function conciseRejection() {
  // ruleid: no-provider-error-echo
  return provider.request().catch(failure => failure.message);
}
async function conciseRedaction() {
  // ok: no-provider-error-echo
  return provider.request().catch(failure => redactSecrets({ input: failure.message }));
}
async function callbackLog() {
  return provider.request().catch(failure => {
    // ruleid: no-provider-error-echo
    logger.error({ detail: failure.response.data });
    return { code: 'FAILED' };
  });
}
