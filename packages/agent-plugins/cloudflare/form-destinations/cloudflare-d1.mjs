import { acknowledgeFormSubmissions, pullFormSubmissions } from '../lib/forms.mjs';

/** Form destination `cloudflare-d1`, co-hosted on Cloudflare Workers: publishing to Workers installs
 * the receiver and its D1 database in the site's own Worker (`lib/target.mjs`); this module only
 * reads and acknowledges what that receiver stored. */
export default {
  pull: pullFormSubmissions,
  ack: acknowledgeFormSubmissions,
};
