/**
 * @file The admin `settings` wire DTOs (SPEC-007 layered settings ledger): the JSON bodies the
 * settings admin routes answer with and an admin client reads. Declared here, once, so the route
 * specs (`@jini-ai/cms/admin-http/routes/settings/*`) and any client mirror read the same shapes
 * without the client depending on CMS. Parsing, authorization and the ledger rules stay in CMS and
 * the settings domain; only the declarations sit here.
 *
 * The row types the read routes list (`EffectiveSettingRow`, `RawSetting`) already live in the
 * settings domain (`@jini-ai/core/settings`), so they are not restated: the list envelope takes its
 * row type as a parameter. The scope union is restated structurally (this file stays outside the
 * settings isolation domain); CMS's `admin-http/routes/settings/__tests__/wire-dtos.test.ts` pins
 * it against `SettingScope` in both directions; keep the two sides identical.
 */

/** The three layers a setting value lives in (the settings domain's `SettingScope`). */
export type AdminSettingScopeDto = 'global' | 'workspace' | 'user';

/** `PUT /settings/value`: the written coordinate, its value and the ledger revision it created. */
export interface AdminSettingValueDto {
  key: string;
  scope: AdminSettingScopeDto;
  value: unknown;
  revisionSeq: number;
}

/** `DELETE /settings/value`: the cleared coordinate reads as unset (`value: null`) again. */
export interface AdminSettingClearedDto extends AdminSettingValueDto {
  value: null;
}

/** `POST /settings/reset`: how many values one namespace reset cleared, and their revisions. */
export interface AdminSettingsResetDto {
  namespace: string;
  clearedCount: number;
  revisionSeqs: number[];
}

/** One definition-batch item's outcome (`op` is the requested operation, `status` its result). */
export interface AdminSettingDefinitionAppliedDto {
  key: string;
  op: string;
  status: string;
}

/** `POST /settings/definitions`: each batch item's outcome, in request order. */
export interface AdminSettingsRegisterDefinitionsDto {
  applied: AdminSettingDefinitionAppliedDto[];
}

/** The `{ data }` envelope the list reads answer (`GET /settings/effective`, `/settings/definitions`). */
export interface AdminSettingsListDto<Row> {
  data: Row[];
}
