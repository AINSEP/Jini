// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../markers/marker.js";
export * from "../../../markers/marker.js";
export function maskNonRenderableRegions(html: Parameters<typeof owner.maskNonRenderableRegions>[0]["html"]) { return owner.maskNonRenderableRegions({ html }); }
export function parseEmbedMarkerConfig(raw: Parameters<typeof owner.parseEmbedMarkerConfig>[0]["raw"]) { return owner.parseEmbedMarkerConfig({ raw }); }
export function scanEmbedMarkers(html: Parameters<typeof owner.scanEmbedMarkers>[0]["html"]) { return owner.scanEmbedMarkers({ html }); }
export function normalizeEmbedMarkerQuoting(html: Parameters<typeof owner.normalizeEmbedMarkerQuoting>[0]["html"]) { return owner.normalizeEmbedMarkerQuoting({ html }); }
export function markersOfType(html: Parameters<typeof owner.markersOfType>[0]["html"], type: Parameters<typeof owner.markersOfType>[0]["type"]) { return owner.markersOfType({ html, type }); }
export function embedMarkerTarget(type: Parameters<typeof owner.embedMarkerTarget>[0]["type"], config: Parameters<typeof owner.embedMarkerTarget>[0]["config"]) { return owner.embedMarkerTarget({ type, config }); }
export function embedMarkerSnippet(type: Parameters<typeof owner.embedMarkerSnippet>[0]["type"], key: Parameters<typeof owner.embedMarkerSnippet>[0]["key"], value: Parameters<typeof owner.embedMarkerSnippet>[0]["value"]) { return owner.embedMarkerSnippet({ type, key, value }); }
export function withInnerContent(marker: Parameters<typeof owner.withInnerContent>[0]["marker"], inner: Parameters<typeof owner.withInnerContent>[0]["inner"]) { return owner.withInnerContent({ marker, inner }); }
export function withAddedId(marker: Parameters<typeof owner.withAddedId>[0]["marker"], id: Parameters<typeof owner.withAddedId>[0]["id"]) { return owner.withAddedId({ marker, id }); }
export function withInnerContentFinal(marker: Parameters<typeof owner.withInnerContentFinal>[0]["marker"], inner: Parameters<typeof owner.withInnerContentFinal>[0]["inner"]) { return owner.withInnerContentFinal({ marker, inner }); }
export function substituteMarkers(html: Parameters<typeof owner.substituteMarkers>[0]["html"], resolve: Parameters<typeof owner.substituteMarkers>[0]["resolve"]) { return owner.substituteMarkers({ html, resolve }); }
export function parseMarkerAttributes(marker: Parameters<typeof owner.parseMarkerAttributes>[0]["marker"]) { return owner.parseMarkerAttributes({ marker }); }
export function formatMarkerAttributes(attrs: Parameters<typeof owner.formatMarkerAttributes>[0]["attrs"]) { return owner.formatMarkerAttributes({ attrs }); }
export function hasAuthoredAttributes(marker: Parameters<typeof owner.hasAuthoredAttributes>[0]["marker"]) { return owner.hasAuthoredAttributes({ marker }); }
export function withInnerContentAndAttributes(marker: Parameters<typeof owner.withInnerContentAndAttributes>[0]["marker"], attrs: Parameters<typeof owner.withInnerContentAndAttributes>[0]["attrs"], inner: Parameters<typeof owner.withInnerContentAndAttributes>[0]["inner"]) { return owner.withInnerContentAndAttributes({ marker, attrs, inner }); }
export function withElementKeptIfAttributed(marker: Parameters<typeof owner.withElementKeptIfAttributed>[0]["marker"], inner: Parameters<typeof owner.withElementKeptIfAttributed>[0]["inner"]) { return owner.withElementKeptIfAttributed({ marker, inner }); }
export function describeRejection(rejection: Parameters<typeof owner.describeRejection>[0]["rejection"]) { return owner.describeRejection({ rejection }); }
