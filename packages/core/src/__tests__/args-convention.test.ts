import { describe, expect, it, vi } from 'vitest';
import {
  apiTokenFromEnv, bindings, configuredAllowedOrigins, createDaemon, definePack,
  isApiTokenMiddlewareEnabled, manyToken, token, ToolInputError,
} from '../index.js';
import { withModelFacingErrors, withModelFacingRegistrationErrors } from '../model-facing-tool-errors.js';
import type { ToolHandler } from '../tool-registry.js';

describe('required args and optional args are separate objects', () => {
  it('retains token version options and literal-id binding inference', () => {
    const service = token<string, 'service'>({ id: 'service' }, { version: 2 });
    const providers = manyToken<number, 'providers'>({ id: 'providers' });
    const bound = bindings({}).bind({ token: service, impl: 'ready' })
      .bindMany({ token: providers, impl: 7 });
    const pack = definePack({
      name: 'example', deps: [service, providers],
      services: (container) => ({
        value: container.get({ token: service }),
        providers: container.getMany({ token: providers }),
      }),
    }, { tools: () => [] });
    const daemon = createDaemon({ packs: [pack], bindings: bound }, { transports: [] });
    expect(daemon.services.example).toEqual({ value: 'ready', providers: [7] });
    expect(service.version).toBe(2);
    expect(providers.version).toBe(1);
  });

  it('uses only the injected environment snapshot', () => {
    const config = { tokenEnvVar: 'EXAMPLE_TOKEN', disableEnvVar: 'EXAMPLE_DISABLE' };
    expect(apiTokenFromEnv({ config, env: { EXAMPLE_TOKEN: ' first ' } })).toBe('first');
    expect(apiTokenFromEnv({ config, env: {} })).toBe('');
    expect(isApiTokenMiddlewareEnabled({ config, env: {
      EXAMPLE_TOKEN: 'first', EXAMPLE_DISABLE: 'yes',
    } })).toBe(false);
  });

  it('reports malformed origins through the injected logger', () => {
    const warn = vi.fn();
    const config = { allowedOriginsEnvVar: 'EXAMPLE_ORIGINS', webPortEnvVar: 'EXAMPLE_PORT', bindHostEnvVar: 'EXAMPLE_HOST' };
    const required = { config, env: { EXAMPLE_ORIGINS: 'ftp://bad.example, https://good.example/path' } };
    expect(configuredAllowedOrigins(required, { logger: { warn } })).toEqual(['https://good.example']);
    expect(warn).toHaveBeenCalledWith({ message: expect.stringContaining('ftp://bad.example') });
    expect(configuredAllowedOrigins(required)).toEqual(['https://good.example']);
  });

  it('preserves error identity, message and optional cause', () => {
    const cause = new Error('cause');
    const error = new ToolInputError({ message: 'invalid field' }, { cause });
    expect(error).toBeInstanceOf(ToolInputError);
    expect(error.name).toBe('ToolInputError');
    expect(error.message).toBe('invalid field');
    expect(error.cause).toBe(cause);
  });

  it('forwards optional handler ports through both error wrappers', async () => {
    const emitSurface = vi.fn(async () => {});
    const handler: ToolHandler = async (_required, { emitSurface: emit } = {}) => {
      await emit?.({ channel: 'example', payload: { answer: 7 } });
      return 'ok';
    };
    const context = {
      executionId: 'execution', principal: { id: 'principal' }, run: { id: 'run' },
      input: {}, signal: new AbortController().signal,
    };
    const wrapped = withModelFacingErrors({ handlers: { example: handler }, rules: [] });
    expect(await wrapped.example!(context, { emitSurface })).toBe('ok');
    const [registration] = withModelFacingRegistrationErrors({ registrations: [{
      descriptor: { id: 'example' }, handler, policy: { authorize: () => 'allow' },
    }], rules: [] });
    expect(await registration!.handler(context, { emitSurface })).toBe('ok');
    expect(emitSurface).toHaveBeenCalledTimes(2);
  });
});
