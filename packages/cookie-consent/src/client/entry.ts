/** @file IIFE entry for dist/client.min.js: boots from #jini-consent-config, with the Jini banner binding.
 * (Measured: the binding adds ~0.35 KB gz, too little to justify a second file for headless pages; an ESM
 * host that wants a headless-only build calls boot() from ./client without bindBanner.) */
import { bindBanner } from './dom.js';
import { boot } from './index.js';

boot(window, { bindBanner });
