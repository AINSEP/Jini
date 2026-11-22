/**
 * Version of the serialized publish-content artifact envelope.
 *
 * Compatibility is exact today: an importer accepts only this version. A future format change must
 * either add an explicit migration or bump this value and keep rejecting older/newer artifacts;
 * silently guessing at compatibility is never allowed.
 */
export const PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION = 1;

