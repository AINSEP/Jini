export {
  buildSrcDoc,
  buildLazySrcDocTransport,
  canActivateSrcDocTransport,
  sanitizeTitleInDoc,
  sanitizePreviewTitle,
  DEFAULT_SRC_DOC_CSP,
  injectAfterHeadOpen,
  injectBeforeHeadEnd,
  injectBeforeBodyEnd,
  type BuildSrcDocOptions,
  type SrcDocActivationInputs,
} from './build.js';
export { applySrcDocBridges, type SrcDocBridge, type SrcDocBridgeContext } from './bridge.js';
