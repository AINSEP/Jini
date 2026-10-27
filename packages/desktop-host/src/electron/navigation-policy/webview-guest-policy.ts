/** Main-process guest admission and unconditional preload/isolation preferences. */
interface GuestWebPreferences {
  preload?: string;
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  webSecurity?: boolean;
  allowRunningInsecureContent?: boolean;
  nodeIntegrationInSubFrames?: boolean;
  experimentalFeatures?: boolean;
}

interface GuestPolicyOptions {
  preloadPath: string;
}

/** Enforce the trusted preload, sandbox, isolation and web security; disable Node and insecure/experimental features. Mutates the event object; throws for an empty preload. @complexity O(1). */
function applyGuestWebPreferences({ webPreferences, ...options }: GuestPolicyOptions & { webPreferences: GuestWebPreferences }, _optionalArgs: Record<string, never> = {}): void {
  // The page chooses webview attributes before this main-process callback. Unconditionally replace
  // its preferences; merging its requested values would let the page choose its own privilege grant.
  // Assign a trusted preload rather than deleting it: embedded admin guests need the same narrow
  // bridge as standalone windows. Mutate this object because Electron ignores a returned replacement.
  if (typeof options?.preloadPath !== "string" || options.preloadPath.length === 0) {
    throw new Error("applyGuestWebPreferences: options.preloadPath is required — a guest with no preload has no voice API.");
  }
  webPreferences.preload = options.preloadPath;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.experimentalFeatures = false;
}

interface GuestAttachEvent {
  preventDefault(): void;
}

interface GuestAttachParams {
  src?: unknown;
}

interface GuestSourceOptions {

  isAllowedSource: (args: { src: string }) => boolean;
}

/** Admit only string sources approved by the host predicate. Missing sources and predicate failures prevent attachment. @complexity O(1) beyond the predicate. */
function admitGuestSource({ event, params, ...options }: GuestSourceOptions & { event: GuestAttachEvent; params: GuestAttachParams }): boolean {
  // Navigation confinement protects an attached guest, not its initial origin. Refuse the source
  // before attach or an arbitrary page gets the trusted preload. Predicate errors become refusals:
  // throwing out of the Electron callback can blank the host window instead of safely denying it.
  let admitted = false;
  try {
    admitted = typeof params?.src === "string" && options.isAllowedSource({ src: params.src });
  } catch {
    admitted = false;
  }
  if (!admitted) event.preventDefault();
  return admitted;
}

export { applyGuestWebPreferences, admitGuestSource };
export type { GuestPolicyOptions, GuestWebPreferences, GuestSourceOptions };
