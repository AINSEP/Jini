/** @module agent-protocol/pi-rpc/models
 * Parses `pi --list-models` tabular stdout into the daemon's model-picker format.
 * No network I/O — accepts the raw stdout string and returns a typed array or null.
 */

import type { RuntimeModelOption } from '../../types.js';

/** A single model entry for the daemon's model-picker: an opaque id and a display label. */
export type PiModelOption = RuntimeModelOption;
export { parsePiModels } from '../../pi-models.js';
