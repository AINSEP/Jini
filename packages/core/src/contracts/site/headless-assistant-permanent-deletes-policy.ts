/**
 * @file The owner's per-site chat permanent-delete policy. Types only.
 *
 * `allowedToolIds` names the permanent-delete tools the owner has opened to the assistant; the host
 * owns the tool catalog, its labels and admin destinations, the settings key and the default (off).
 */

export interface AssistantPermanentDeletesPolicy { enabled: boolean; allowedToolIds: string[] }
