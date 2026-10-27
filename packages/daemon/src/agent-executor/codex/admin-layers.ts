import { execFile } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { errorMessage, isRecord } from '../values.js';
import { buildCodexSystemServersOffToml, CodexMcpIsolationError } from './isolation.js';

/**
 * What {@link probeCodexAdminLayers} reads, every port injectable so each platform's paths are
 * testable on any OS.
 */
export interface CodexAdminLayerPorts {
  readonly platform: NodeJS.Platform;
  /** The daemon host's environment (Windows `ProgramData`). */
  readonly env: NodeJS.ProcessEnv;
  /** A file's text, `null` when it does not exist; rejects when it exists but can't be read (fail closed). */
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string | null>;
  /** Whether macOS preferences `com.openai.codex` carry `config_toml_base64` or `requirements_toml_base64`; rejects when they can't be read. */
  readonly macManagedPrefsPresent: () => Promise<boolean>;
}

/** `clear`: Codex's own trust gate isolates the run once the system servers are off; `blocked`: an admin layer can't be turned off. */
export type CodexAdminLayers =
  | { readonly status: 'clear'; readonly systemServersOffToml: string }
  | { readonly status: 'blocked'; readonly reason: string };

/**
 * ChatGPT plans that never receive a cloud-managed Codex config. codex-rs
 * `cloud-config/src/service.rs` `cloud_config_eligible_auth` fetches one for business-like,
 * education-like and enterprise plans; anything not known to be personal (team, a future plan) is
 * treated as eligible, failing closed.
 */
const PERSONAL_CHATGPT_PLANS = new Set(['free', 'go', 'plus', 'pro', 'prolite']);

/** The system Codex folder: `/etc/codex`, or `%ProgramData%\OpenAI\Codex` on Windows (loader/mod.rs L:820-842). */
function codexSystemDir({ platform, env }: CodexAdminLayerPorts): { dir: string; join: (...parts: string[]) => string } {
  if (platform !== 'win32') return { dir: '/etc/codex', join: posix.join };
  return { dir: win32.join(env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData', 'OpenAI', 'Codex'), join: win32.join };
}

/** The `chatgpt_plan_type` claim of the stored sign-in's id_token (codex-rs `login/src/token_data.rs`), or `null` with no ChatGPT sign-in or no plan claim. */
function chatgptPlan(authRaw: string | null): string | null {
  if (authRaw === null) return null;
  const auth: unknown = JSON.parse(authRaw);
  const idToken = isRecord(auth) && isRecord(auth.tokens) ? auth.tokens.id_token : undefined;
  if (idToken === undefined) return null;
  if (typeof idToken !== 'string') throw new Error('its id_token is not a string');
  const claims: unknown = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
  const authClaims = isRecord(claims) ? claims['https://api.openai.com/auth'] : undefined;
  const plan = isRecord(authClaims) ? authClaims.chatgpt_plan_type : undefined;
  return typeof plan === 'string' ? plan : null;
}

/** Refuses a ChatGPT sign-in whose plan can receive a cloud-managed config Jini can't read or out-rank. */
async function assertNoCloudConfig({ sourceHome, ports }: { sourceHome: string; ports: CodexAdminLayerPorts }): Promise<void> {
  const authPath = join(sourceHome, 'auth.json');
  const authRaw = await ports.readFile({ path: authPath });
  let plan: string | null;
  try {
    plan = chatgptPlan(authRaw);
  } catch {
    // No parser message here: JSON.parse quotes the input, and this file holds sign-in tokens.
    throw new CodexMcpIsolationError(`the Codex sign-in in ${authPath} can't be checked for a cloud-managed config.`);
  }
  if (plan !== null && !PERSONAL_CHATGPT_PLANS.has(plan)) {
    throw new CodexMcpIsolationError('the ChatGPT workspace Codex signs in with can push an admin-managed config that can\'t be turned off.');
  }
}

/** Throws for any admin layer present; returns the system config's servers-off TOML. */
async function checkAdminLayers({ sourceHome, ports }: { sourceHome: string; ports: CodexAdminLayerPorts }): Promise<string> {
  const system = codexSystemDir(ports);
  // Legacy managed_config.toml is not loaded on Windows (loader/layer_io.rs L:65-67). Codex never
  // loads `$CODEX_HOME/managed_config.toml` (layer_io.rs L:222-228 reads only the system one).
  const managed = ['requirements.toml', ...(ports.platform === 'win32' ? [] : ['managed_config.toml'])];
  for (const path of managed.map(name => system.join(system.dir, name))) {
    if (await ports.readFile({ path }) !== null) throw new CodexMcpIsolationError(`the admin-managed ${path} can't be turned off.`);
  }
  if (ports.platform === 'darwin' && await ports.macManagedPrefsPresent()) {
    throw new CodexMcpIsolationError('macOS managed preferences (com.openai.codex) set a Codex config that can\'t be turned off.');
  }
  await assertNoCloudConfig({ sourceHome, ports });
  const configPath = system.join(system.dir, 'config.toml');
  const raw = await ports.readFile({ path: configPath });
  return raw === null ? '' : buildCodexSystemServersOffToml({ raw, path: configPath });
}

/**
 * Whether a personal-MCP-OFF Codex run can be isolated by the staged home alone. The staged home
 * trusts no project, so Codex's trust gate keeps every project layer out; what is left are the
 * admin layers above or beside it, the same sources Codex's own `has_local_managed_configuration`
 * probes (codex-rs `config/src/loader/mod.rs` L:764-797) plus the cloud bundle: `requirements.toml`,
 * legacy `managed_config.toml`, macOS managed preferences, and a workspace ChatGPT plan block the
 * run; a system `config.toml` is parsed and its servers turned off. Any read error blocks.
 * @param sourceHome - The real Codex home, whose `auth.json` names the signed-in plan.
 * @returns `clear` with the system servers-off TOML, or `blocked` with a user-facing reason.
 * @complexity O(n) in the system config's length; at most five reads and one preferences query.
 */
export async function probeCodexAdminLayers({ sourceHome, ports }: {
  readonly sourceHome: string; readonly ports: CodexAdminLayerPorts;
}, _optional: Record<string, never> = {}): Promise<CodexAdminLayers> {
  try {
    return { status: 'clear', systemServersOffToml: await checkAdminLayers({ sourceHome, ports }) };
  } catch (err) {
    const reason = err instanceof CodexMcpIsolationError ? err.message : `a Codex admin config can't be checked (${errorMessage(err)}).`;
    return { status: 'blocked', reason };
  }
}

async function readFileOrNull({ path }: { readonly path: string }): Promise<string | null> {
  try {
    return await fsPromises.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// CFPreferencesCopyAppValue is the API Codex itself reads managed preferences with (loader/macos.rs L:123-140).
const MAC_PREFS_SCRIPT = 'ObjC.import("CoreFoundation"); function run(argv) { return argv.slice(1).some(function (k) { '
  + 'return !ObjC.castRefToObject($.CFPreferencesCopyAppValue($(k), $(argv[0]))).isNil(); }) ? "present" : "absent"; }';

function macManagedPrefsPresent(): Promise<boolean> {
  return new Promise((resolvePresent, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_PREFS_SCRIPT, 'com.openai.codex', 'config_toml_base64', 'requirements_toml_base64'],
      { timeout: 5_000 }, (err, stdout) => {
        const answer = String(stdout).trim();
        if (err || (answer !== 'present' && answer !== 'absent')) reject(err ?? new Error(`unexpected preferences answer "${answer}"`));
        else resolvePresent(answer === 'present');
      });
  });
}

/** The real host's ports: `process.platform`, the given env, the filesystem, and `osascript`. */
export function defaultCodexAdminLayerPorts({ env }: { readonly env: NodeJS.ProcessEnv }): CodexAdminLayerPorts {
  return { platform: process.platform, env, readFile: readFileOrNull, macManagedPrefsPresent };
}
