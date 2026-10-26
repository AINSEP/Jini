// A stand-in for a vendor's consent adapter. It arrives late (the server delays it) and may load before or
// after the consent client: pushing onto window.jiniConsentQueue works either way. It only "runs" once the
// visitor allows analytics and its receipt is stored, and it stops cleanly when consent is withdrawn.
(window.jiniConsentQueue ||= []).push({
  id: 'fake-vendor',
  kind: 'consent-adapter',
  category: 'analytics',
  storage: { cookies: ['_fake_'], local: ['fake:'] },
  grant({ signal }) {
    if (signal.aborted) return null;
    document.cookie = '_fake_id=1; Path=/';
    document.getElementById('vendor').value = 'running (analytics allowed)';
    return { revoke() { document.getElementById('vendor').value = 'stopped (analytics withdrawn)'; return true; } };
  },
  onState({ state }) {
    if (!state.allowed.analytics) document.getElementById('vendor').value = 'loaded, waiting for analytics consent';
  },
});
