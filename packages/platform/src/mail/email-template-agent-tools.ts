/**
 * @file Email-template tools. Same permissions as the Pages HTML tools they mirror: reading is
 * `content.read`, writing raw HTML is `pages.edit_html` (a template is raw HTML on Pages storage).
 */

const FIELD_CONTRACT =
  "A template is a full HTML email document. Its <title> is the subject (it may use fields). Fill-in fields are " +
  "written {{name}} anywhere in the HTML or the subject and declared in the head as " +
  '<meta name="email-fields" content="name=Ada, orderId">, each name optionally =sample (the value previews use). ' +
  "Values are HTML-escaped; a field with no value renders empty and is listed in missingFields. " +
  "Use table layout and inline styles: mail clients ignore most CSS and all script. Scripts run only in the admin " +
  "preview; sent emails are static HTML with <script>, on* handlers, javascript: URLs, <iframe>/<object>/<embed> " +
  "and comments removed.";

const VALUES_SCHEMA = {
  type: "object",
  description: "Field values by name, e.g. {\"name\":\"Ada\"}.",
  additionalProperties: { type: ["string", "number", "boolean"] },
};

/** The host's names the email-template catalog text and authorization carry. */
export interface EmailTemplatesHostCopy {
  /** The host permission that writes raw HTML (its Pages HTML edit permission), named in the write tools' text and authorization. */
  readonly editHtmlPermission: string;
}

/** The read-only list tool: no host wording, so it is a static declaration. */
const EMAIL_TEMPLATE_LIST_TOOL = {
  name: "email_template_list",
  description: "Lists this site's HTML email templates. Returns {templates:[{id,name,subject,fields,version,updatedAt}]}. Requires content.read.",
  sideEffects: "none" as const,
  authorization: { permission: "content.read" },
  inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100, clamp: true }, cursor: { type: "string" } } },
};

/** The read-only get tool: carries the field contract, which is static text. */
const EMAIL_TEMPLATE_GET_TOOL = {
  name: "email_template_get",
  description: `Reads one email template: {id,name,subject,fields,version,updatedAt,html,undeclaredFields}. Pass version back as expectedVersion when editing. ${FIELD_CONTRACT} Requires content.read.`,
  sideEffects: "none" as const,
  authorization: { permission: "content.read" },
  inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
};

/** The read-only preview tool: renders and sends nothing. */
const EMAIL_TEMPLATE_PREVIEW_TOOL = {
  name: "email_template_preview",
  description: "Renders an email template with field values, as the live preview shows it. Pass id for a saved template or html for unsaved markup. mode admin (default) fills declared samples for missing values and keeps scripts; mode sent returns exactly what would be emailed (static html plus the plain-text alternative). Returns {subject,html,missingFields,undeclaredFields,mode,scriptsStripped,text?}. Sends nothing. Requires content.read.",
  sideEffects: "none" as const,
  authorization: { permission: "content.read" },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { id: { type: "string" }, html: { type: "string" }, values: VALUES_SCHEMA, mode: { type: "string", enum: ["admin", "sent"] } },
  },
};

/** The create and edit tools: the only ones whose text and authorization name the host's edit-HTML permission. */
function emailTemplateWriteTools({ copy }: { copy: EmailTemplatesHostCopy }) {
  return [
  {
      name: "email_template_create",
      description: `Creates an HTML email template. Give html for the full document, or omit it to start from a simple starter email built from subject and fields. Returns the template as email_template_get does. ${FIELD_CONTRACT} Requires ${copy.editHtmlPermission}.`,
      sideEffects: "mutates-durable-state" as const,
      authorization: { permission: copy.editHtmlPermission },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", maxLength: 200, description: "Admin-facing name, e.g. Order confirmation." },
          html: { type: "string", description: "The full HTML document." },
          subject: { type: "string", description: "Starter only (ignored with html): the subject; defaults to name." },
          fields: { type: "array", items: { type: "string" }, description: "Starter only (ignored with html): field names, each optionally name=sample." },
        },
      },
    },
  {
      name: "email_template_edit",
      description: `Replaces an email template's whole HTML document. Read it first with email_template_get and send its version as expectedVersion; a stale version writes nothing (EMAIL_TEMPLATES_VERSION_CONFLICT). Returns the saved template. ${FIELD_CONTRACT} Requires ${copy.editHtmlPermission}.`,
      sideEffects: "mutates-durable-state" as const,
      authorization: { permission: copy.editHtmlPermission },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "html", "expectedVersion"],
        properties: { id: { type: "string" }, html: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 } },
      },
    },
  ];
}

/**
 * The email-template tool catalog, bound once by the host with its {@link EmailTemplatesHostCopy};
 * bound with the host's own permission name, the model-facing text is the host's original catalog text.
 */
export function createEmailTemplatesAgentToolCatalog({ copy }: { copy: EmailTemplatesHostCopy }, _optional: Record<string, never> = {}) {
  return [EMAIL_TEMPLATE_LIST_TOOL, EMAIL_TEMPLATE_GET_TOOL, ...emailTemplateWriteTools({ copy }), EMAIL_TEMPLATE_PREVIEW_TOOL];
}
