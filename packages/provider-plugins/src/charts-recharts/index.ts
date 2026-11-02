/** Browser-only provider: the server entry registers nothing. Charts reach the browser only through
 * the host's admitted, integrity-pinned `client/` assets (`browserProviders` in jini.plugin.json). */
export default { definition: { setup(): void {} } };
