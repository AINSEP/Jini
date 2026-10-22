/** Host-independent collect-all manifest validation; vocabularies are host inputs. */
export interface GlueVocabulary { readonly capabilities: readonly string[]; readonly callSites: readonly string[] }

export type GlueCallSite = string;

export type GlueCapability = string;

export interface GlueManifestAttachment {
  readonly callSite: GlueCallSite;
  readonly [payloadKey: string]: unknown;
}

export interface GlueManifest {
  readonly id: string;
  readonly version: string;
  readonly sdkRange: string;
  readonly capabilities: readonly GlueCapability[];
  readonly attachments: readonly GlueManifestAttachment[];
}

export interface GlueManifestValidationError {
  readonly code: string;
  readonly file: string | null;
  readonly message: string;
}

export interface ValidateGlueManifestRequired {
  readonly manifest: unknown;
  readonly vocabulary: GlueVocabulary;
}

export type ValidateGlueManifestOptional = Record<string, never>;

export interface ValidateGlueManifestResult {
  readonly errors: readonly GlueManifestValidationError[];
}

const REQUIRED_KEYS = ["id", "version", "sdkRange", "capabilities", "attachments"] as const;
const ALLOWED_KEYS = new Set<string>(REQUIRED_KEYS);

const ID_PATTERN = /^[a-z0-9-]+$/;
const MAX_ID_LENGTH = 50;



function malformed(message: string): GlueManifestValidationError {
  return { code: "MANIFEST_MALFORMED", file: null, message };
}

function validateKeys(raw: Readonly<Record<string, unknown>>): GlueManifestValidationError[] {
  const errors: GlueManifestValidationError[] = [];
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(malformed(`unknown manifest key '${key}'`));
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined) {
      errors.push(malformed(`missing required manifest field '${key}'`));
    }
  }
  return errors;
}

function validateId(raw: Readonly<Record<string, unknown>>): GlueManifestValidationError[] {
  const errors: GlueManifestValidationError[] = [];
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (raw.id !== undefined && id === undefined) {
    errors.push(malformed("'id' must be a string"));
  }
  if (id !== undefined && (!ID_PATTERN.test(id) || id.length < 1 || id.length > MAX_ID_LENGTH)) {
    errors.push(malformed(`id '${id}' must match ${ID_PATTERN} and be 1-${MAX_ID_LENGTH} characters`));
  }
  return errors;
}

function validateVersionAndSdkRange(raw: Readonly<Record<string, unknown>>): GlueManifestValidationError[] {
  const errors: GlueManifestValidationError[] = [];
  if (raw.version !== undefined && typeof raw.version !== "string") {
    errors.push(malformed("'version' must be a string"));
  }
  if (raw.sdkRange !== undefined && typeof raw.sdkRange !== "string") {
    errors.push(malformed("'sdkRange' must be a string"));
  }
  return errors;
}

function validateCapabilities(raw: Readonly<Record<string, unknown>>, vocabulary: GlueVocabulary): GlueManifestValidationError[] {
  const errors: GlueManifestValidationError[] = [];
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  if (raw.capabilities !== undefined && !Array.isArray(raw.capabilities)) {
    errors.push(malformed("'capabilities' must be an array"));
  }
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !vocabulary.capabilities.includes(capability)) {
      errors.push({
        code: "CAPABILITY_UNKNOWN",
        file: null,
        message: `capability '${String(capability)}' is outside the supplied capability vocabulary`,
      });
    }
  }
  return errors;
}

function validateAttachment(attachment: unknown, vocabulary: GlueVocabulary): GlueManifestValidationError[] {
  if (typeof attachment !== "object" || attachment === null || Array.isArray(attachment)) {
    return [malformed("each 'attachments' entry must be an object")];
  }
  const callSite = (attachment as Readonly<Record<string, unknown>>).callSite;
  if (typeof callSite !== "string" || !vocabulary.callSites.includes(callSite)) {
    return [
      {
        code: "CALL_SITE_UNKNOWN",
        file: null,
        message: `call site '${String(callSite)}' is outside the supplied call-site vocabulary`,
      },
    ];
  }
  return [];
}

function validateAttachments(raw: Readonly<Record<string, unknown>>, vocabulary: GlueVocabulary): GlueManifestValidationError[] {
  const errors: GlueManifestValidationError[] = [];
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  if (raw.attachments !== undefined && !Array.isArray(raw.attachments)) {
    errors.push(malformed("'attachments' must be an array"));
  }
  for (const attachment of attachments) {
    errors.push(...validateAttachment(attachment, vocabulary));
  }
  return errors;
}

export function validateGlueManifest(
  required: ValidateGlueManifestRequired,
  _optional: ValidateGlueManifestOptional = {}
): ValidateGlueManifestResult {
  const { manifest, vocabulary } = required;

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { errors: [malformed("glue manifest must be a JSON object")] };
  }

  // Treat the input as a read-only bag of unknown values — never assigned back into.
  const raw = manifest as Readonly<Record<string, unknown>>;

  const errors: GlueManifestValidationError[] = [
    ...validateKeys(raw),
    ...validateId(raw),
    ...validateVersionAndSdkRange(raw),
    ...validateCapabilities(raw, vocabulary),
    ...validateAttachments(raw, vocabulary),
  ];

  return { errors };
}

export type GlueCallSiteDispatchStatus =
  | { readonly wired: true }
  | { readonly wired: false; readonly code: "UNWIRED_CALL_SITE" };

export function resolveCallSiteDispatch({ callSite, wiredCallSites }: { callSite: GlueCallSite; wiredCallSites: readonly GlueCallSite[] }, _optional: Record<string, never> = {}): GlueCallSiteDispatchStatus {
  return wiredCallSites.includes(callSite) ? { wired: true } : { wired: false, code: "UNWIRED_CALL_SITE" };
}
