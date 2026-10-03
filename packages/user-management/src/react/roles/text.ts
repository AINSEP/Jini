import { splitOnPlaceholders, type Translate } from "@jini-ai/ui/panel-kit";

export function rolesDescriptionParts({ translate }: { translate: Translate }) {
  const [prefix = "", suffix = ""] = splitOnPlaceholders({ template: translate("Roles and policies grant access to operator users. Assign a role or policy to a specific user from the {users} screen."), tokens: ["{users}"] });
  return { prefix, suffix, linkLabel: translate("Users") };
}

function nameParts(translate: Translate, template: string) {
  const [prefix = "", suffix = ""] = splitOnPlaceholders({ template: translate(template), tokens: ["{name}"] });
  return { prefix, suffix };
}

export function roleDeleteBodyParts({ translate }: { translate: Translate }) { return nameParts(translate, 'Delete role "{name}"?'); }
export function policyDeleteBodyParts({ translate }: { translate: Translate }) { return nameParts(translate, 'Delete policy "{name}"?'); }
export function permissionRemoveBodyParts({ translate }: { translate: Translate }) { return nameParts(translate, 'Remove "{name}" from this policy? Anyone with this policy loses it.'); }
