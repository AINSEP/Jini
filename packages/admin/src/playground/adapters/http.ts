/** The source registers a local portal node. It has no server route to adapt.
 * Serializing that node or inventing a backend would change the whiteboard contract. */
export const playgroundHttpSupport = Object.freeze({ supported: false as const, routes: Object.freeze([] as readonly string[]), reason: 'Playground is a browser render-target handshake with no HTTP routes.' });
