import { request as sendSecure } from 'node:https';
import { request as sendUndici } from 'undici';
import * as nativeHttp from 'node:http';
import secureHttp from 'https';

// ruleid: no-raw-fetch
fetch(url);
// ruleid: no-raw-fetch
globalThis.fetch(url);
// ruleid: no-raw-fetch
window.fetch(url);
// ruleid: no-raw-fetch
undici.request(url);
// ruleid: no-raw-fetch
http.request(url);
// ruleid: no-raw-fetch
https.request(url);
// ruleid: no-raw-fetch
sendSecure(url);
// ruleid: no-raw-fetch
sendUndici(url);
// ruleid: no-raw-fetch
nativeHttp.request(url);
// ruleid: no-raw-fetch
secureHttp.request(url);

const { request: sendCommonJs } = require('node:http');
// ruleid: no-raw-fetch
sendCommonJs(url);
// ruleid: no-raw-fetch
require('undici').request(url);

// ok: no-raw-fetch
guardedFetch({ client, url });
// ok: no-raw-fetch
client.request({ url, method: 'GET' });
// ok: no-raw-fetch
ports.fetchFn({ url });
// ok: no-raw-fetch
queue.request({ task: 'work' });
