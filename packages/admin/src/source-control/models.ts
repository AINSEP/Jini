export interface SourceControlField { readonly name: string; readonly label: string; readonly secret?: boolean; readonly required?: boolean; readonly hint?: string; readonly userHelp?: string; readonly help?: string }
export interface SourceControlProvider { readonly id: string; readonly label: string; readonly credential?: { readonly tokenField: string; readonly fields: readonly SourceControlField[]; readonly tokenPageUrl?: string; readonly help?: string } }
export interface SourceControlCredential { readonly id: string; readonly providerId: string; readonly label: string; readonly configured: true; readonly isDefault: boolean; readonly createdAt: string; readonly updatedAt: string }
export type SourceControlConnection = { providerId: string; token: string } & Readonly<Record<string, string>>;
export interface SourceControlCredentialInput { readonly label: string; readonly connection: SourceControlConnection; readonly isDefault?: boolean }
export interface SourceControlCredentialPatch { readonly label?: string; readonly connection?: SourceControlConnection; readonly isDefault?: boolean }
export interface SourceControlDraft { readonly token: string; readonly values: Readonly<Record<string, string>>; readonly saving: boolean; readonly error: string | null }
export interface SourceControlProviderInfo { readonly id: string; readonly label: string; readonly listed: boolean; readonly tokenLabel: string; readonly fields: readonly SourceControlField[]; readonly tokenPageUrl: string; readonly help: string }
export interface SourceControlState { readonly providers: readonly SourceControlProvider[]; readonly credentials: readonly SourceControlCredential[]; readonly drafts: Readonly<Record<string, SourceControlDraft>>; readonly loading: boolean; readonly loaded: boolean; readonly error: string | null; readonly catalogError: string | null }
export interface SourceControlRequestOptions { readonly signal?: AbortSignal }
