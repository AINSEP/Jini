---
name: google-forms
description: Select a published public Google Form for collection, or switch back to built-in collection.
---
Use the existing authorized `list form providers`, `list form definitions` and `update the form provider configuration` tools. List current providers before choosing one. Enable the Google Forms provider plugin with the normal plugin controls; installation does not select it for any form.

Ask for the published public responder link, exactly `https://docs.google.com/forms/d/e/<form-id>/viewform` (optionally `?embedded=true`). Do not use an edit link or a shortened forms.gle link. Publish the form in Google Forms, allow public responders, and verify the responder link in an anonymous browser without a Google sign-in. A valid URL does not prove the form is public, published, open, or accepting answers. A real public form must still be checked before acceptance.

Explain the destination before changing it and follow the owner's requested choice: Google owns the questions, validation and new answers. Local field edits do not change Google's questions, and new answers do not enter the built-in inbox. This integration does not create Google forms, request OAuth or API keys, import answers, synchronize data, install webhooks or probe availability. Do not promise that an iframe load proves the form works.

Select with `provider: { id: "google_forms", config: { url: "https://docs.google.com/forms/d/e/<form-id>/viewform" } }` through `update the form provider configuration`. Switch back with `provider: { id: "builtin", config: {} }`. Preserve the existing local fields, HTML and historical answers when switching.

The embed declares functional consent. With consent enabled it stays inert until effective permission allows it; without consent infrastructure it remains inert. Explicit consent-off mode delivers the frame normally. Keep the visible public-link alternative: “If this form does not open, open it on Google or contact the site owner.” Google may reject private or closed forms; do not claim automatic detection.

Republish every affected static page after switching. Retain pending built-in receiver data and existing local history; switching collection providers never authorizes deleting them.
