import type { FormFieldKindInfo } from '../../../core/ports/forms-catalog.js';

/**
 * @file Data copied from the forms domain's field registry and file-safety tables (recorded 2026-11-17), so admin's tests
 * describe the catalog the host hands in without importing the domain package. A change in the domain's tables is
 * caught at the host's binding (its `satisfies FormsCatalogPort`), not here.
 */
export const catalogFieldKinds: Readonly<Record<string, FormFieldKindInfo>> = {
  "text": {
    "control": "input",
    "htmlType": "text",
    "textual": true
  },
  "textarea": {
    "control": "textarea",
    "htmlType": "textarea",
    "textual": true
  },
  "email": {
    "control": "input",
    "htmlType": "email",
    "textual": true
  },
  "phone": {
    "control": "input",
    "htmlType": "tel",
    "textual": true
  },
  "url": {
    "control": "input",
    "htmlType": "text",
    "attributes": {
      "inputmode": "url",
      "autocomplete": "url",
      "spellcheck": "false",
      "autocapitalize": "off"
    },
    "textual": true
  },
  "number": {
    "control": "input",
    "htmlType": "number"
  },
  "range": {
    "control": "input",
    "htmlType": "range"
  },
  "date": {
    "control": "input",
    "htmlType": "date"
  },
  "time": {
    "control": "input",
    "htmlType": "time"
  },
  "datetime": {
    "control": "input",
    "htmlType": "datetime-local"
  },
  "select": {
    "control": "select",
    "htmlType": "select",
    "choices": true
  },
  "multi-select": {
    "control": "select",
    "htmlType": "select",
    "choices": true,
    "multiple": true
  },
  "radio": {
    "control": "group",
    "htmlType": "radio",
    "choices": true
  },
  "checkbox": {
    "control": "input",
    "htmlType": "checkbox"
  },
  "checkbox-group": {
    "control": "group",
    "htmlType": "checkbox",
    "choices": true,
    "multiple": true
  },
  "toggle": {
    "control": "input",
    "htmlType": "checkbox"
  },
  "file": {
    "control": "input",
    "htmlType": "file"
  },
  "hidden": {
    "control": "input",
    "htmlType": "hidden",
    "textual": true
  }
};

export const catalogMaxFileBytes = 10485760;

export const catalogSafeFileTypes: Readonly<Record<string, readonly string[]>> = {
  "image/png": [
    "png"
  ],
  "image/jpeg": [
    "jpg",
    "jpeg"
  ],
  "image/gif": [
    "gif"
  ],
  "image/webp": [
    "webp"
  ],
  "image/avif": [
    "avif"
  ],
  "video/mp4": [
    "mp4"
  ],
  "video/webm": [
    "webm"
  ],
  "application/pdf": [
    "pdf"
  ]
};
