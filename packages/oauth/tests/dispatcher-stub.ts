import { EventEmitter } from 'node:events';
import type { OAuthEmptyArgs } from '../src/args.js';
import type { OAuthDispatcherPort } from '../src/dns-pinned-transport.js';

const unexpectedCall = (): never => { throw new Error('Unexpected native dispatcher call'); };

class OAuthDispatcherStub extends EventEmitter {
  dispatch = unexpectedCall;
  connect = unexpectedCall;
  compose = unexpectedCall;
  request = unexpectedCall;
  pipeline = unexpectedCall;
  stream = unexpectedCall;
  upgrade = unexpectedCall;
  close = unexpectedCall;
  destroy = unexpectedCall;
  listeners = unexpectedCall;
  rawListeners = unexpectedCall;
}

/** A complete dispatcher double for identity assertions; HTTP is handled by the injected fetch.
 * Native dispatcher calls fail immediately so a test cannot accidentally open a connection.
 * @complexity O(1) time and space.
 */
export function createOAuthDispatcherStub(_requiredArgs: OAuthEmptyArgs): OAuthDispatcherPort['dispatcher'] {
  return new OAuthDispatcherStub();
}
