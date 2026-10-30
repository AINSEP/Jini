/** Source of the published IIFE asset; the build bundles this browser entry. */
import { bindBanner, boot } from './client/index.js';

boot(window, { bindBanner });
