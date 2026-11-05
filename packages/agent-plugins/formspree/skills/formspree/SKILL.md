---
name: formspree
description: Select Formspree collection for a site form using its public endpoint, or switch back to built-in collection.
---
Use the existing authorized `forms_list_definitions` and `forms_update_definition` tools. Enable the Formspree provider plugin first using the normal plugin controls. Do not create vendor forms, ask for API keys, synchronize submissions or build Google Forms.

Ask the owner for the public native form endpoint shown by Formspree (https://formspree.io/f/<form-id>). It is a public destination, never a secret. Preview where answers will go and get the owner's requested choice before changing it: Formspree keeps answers in the owner's Formspree account, browser and Formspree validation apply, and Formspree supplies spam protection according to that account's settings. Existing local history and frozen delivery jobs remain unchanged.

Set `provider: { id: "formspree", config: { endpoint: "https://formspree.io/f/<form-id>" } }` using `forms_update_definition`. Switch back with `provider: { id: "builtin", config: {} }`. Never replace the form's fields or HTML to switch providers.

Every already published page containing the form must be republished. For Cloudflare, republish the receiver manifest/routes too. Do not delete the old receiver or pending remote answers: they never auto-expire and must finish importing. Notification recipients stay local when content is copied between sites; show that in the transfer preview.
