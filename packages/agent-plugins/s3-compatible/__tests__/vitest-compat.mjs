import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { after, mock } from "node:test";

/**
 * @file The small slice of vitest's `expect` / `vi` API the ported devops deploy-target suites use,
 * over `node:assert` and `node:test`, so those suites run on `node --test` unchanged ("port them,
 * don't re-author"). Moved with the plugin from its first host's test fixtures (types stripped).
 * This file is identical in every hosting plugin that uses it.
 *
 * Covered, and nothing else: `toBe`, `toEqual`, `toMatchObject`, `toThrow`, `toBeInstanceOf`,
 * `toBeUndefined`, `toBeNull`, `toBeDefined`, `toHaveLength`, `toMatch`, `toContain`,
 * `toBeGreaterThan`, `toHaveProperty`, `toHaveBeenCalled`, `toHaveBeenCalledTimes`, with `.not` and
 * `.rejects`; `expect.stringContaining`; `vi.fn` (+ `mockResolvedValue`, `mockClear`, `mock.calls`),
 * `vi.stubGlobal` / `vi.unstubAllGlobals`, and fake timers over `node:test`'s `mock.timers`.
 * An unsupported matcher is a TypeError at the call, never a silent pass.
 *
 * Also owns the network guard: {@link installNetworkGuard} makes the unstubbed global `fetch` throw
 * and fails the file if anything reached it, so a ported case that forgot its stub can never call
 * a real host.
 */

const ASYMMETRIC = Symbol("asymmetric-matcher");

function isAsymmetric(value) {
  return typeof value === "object" && value !== null && value[ASYMMETRIC] === true;
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * vitest's equality: asymmetric matchers match by predicate, plain objects compare by own keys with
 * `undefined`-valued keys ignored (`toEqual`), arrays element-wise, everything else by
 * `isDeepStrictEqual`. `partial` is `toMatchObject`: only the expected object's keys must match.
 * @complexity O(n) in the size of `expected`.
 */
function equals(actual, expected, partial) {
  if (isAsymmetric(expected)) return expected.matches(actual);
  if (Array.isArray(expected)) return equalArrays(actual, expected, partial);
  if (isPlainRecord(expected)) return equalRecords(actual, expected, partial);
  return Object.is(actual, expected) || isDeepStrictEqual(actual, expected);
}

function equalArrays(actual, expected, partial) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => equals(actual[i], item, partial));
}

/** Own keys with `undefined` values ignored, as vitest's `toEqual` compares them. */
const definedKeys = (source) => Object.keys(source).filter((key) => source[key] !== undefined);

function equalRecords(actual, expected, partial) {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
  const expectedKeys = definedKeys(expected);
  const expectedMatch = expectedKeys.every((key) => equals(actual[key], expected[key], partial));
  if (partial) return expectedMatch;
  return expectedMatch && definedKeys(actual).length === expectedKeys.length && definedKeys(actual).every((key) => key in expected);
}

function throwMatches(error, expected) {
  if (expected === undefined) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof expected === "string") return message.includes(expected);
  if (expected instanceof RegExp) return expected.test(message);
  if (typeof expected === "function") return error instanceof expected;
  return equals(error, expected, true);
}

function isMockFn(value) {
  return typeof value === "function" && typeof value.mock === "object";
}

function show(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Each matcher returns `[pass, message]`: whether it passed plus the failure text for the non-negated form. */
function matchers(actual) {
  const calls = () => {
    assert.ok(isMockFn(actual), "expected a vi.fn() mock");
    return actual.mock.calls;
  };
  return {
    toBe: (expected) => [Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`],
    toEqual: (expected) => [equals(actual, expected, false), `expected ${show(actual)} to equal ${show(expected)}`],
    toMatchObject: (expected) => [equals(actual, expected, true), `expected ${show(actual)} to match ${show(expected)}`],
    toBeInstanceOf: (cls) => [actual instanceof cls, `expected ${show(actual)} to be an instance of ${cls.name}`],
    toBeUndefined: () => [actual === undefined, `expected ${show(actual)} to be undefined`],
    toBeNull: () => [actual === null, `expected ${show(actual)} to be null`],
    toBeDefined: () => [actual !== undefined, "expected a defined value"],
    toHaveLength: (length) => [actual?.length === length, `expected length ${show(actual?.length)} to be ${show(length)}`],
    toMatch: (pattern) => [
      typeof actual === "string" && (pattern instanceof RegExp ? pattern.test(actual) : actual.includes(String(pattern))),
      `expected ${show(actual)} to match ${String(pattern)}`,
    ],
    toContain: (item) => [
      typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.includes(item),
      `expected ${show(actual)} to contain ${show(item)}`,
    ],
    toBeGreaterThan: (bound) => [actual > bound, `expected ${show(actual)} to be greater than ${show(bound)}`],
    toHaveProperty: (...args) => {
      const has = typeof actual === "object" && actual !== null && Object.hasOwn(actual, args[0]);
      const valueOk = args.length < 2 || (has && equals(actual[args[0]], args[1], false));
      return [has && valueOk, `expected ${show(actual)} to have property ${String(args[0])}`];
    },
    toHaveBeenCalled: () => [calls().length > 0, "expected the mock to have been called"],
    toHaveBeenCalledTimes: (count) => [calls().length === count, `expected ${calls().length} calls to be ${show(count)}`],
    toThrow: (expected) => {
      assert.equal(typeof actual, "function", "toThrow needs a function (or .rejects)");
      try {
        actual();
      } catch (error) {
        return [throwMatches(error, expected), `expected thrown ${show(error?.message ?? error)} to match ${String(expected)}`];
      }
      return [false, "expected the function to throw"];
    },
  };
}

function bindMatchers(actual, negate, label) {
  return new Proxy({}, {
    get(_target, name) {
      const matcher = matchers(actual)[name];
      if (!matcher) throw new TypeError(`vitest-compat: unsupported matcher '${String(name)}'`);
      return (...args) => {
        const [pass, message] = matcher(...args);
        const described = label === undefined ? message : `${label}: ${message}`;
        if (pass === negate) assert.fail(negate ? `NOT: ${described}` : described);
      };
    },
  });
}

/** `.rejects`: awaits the promise, requires a rejection, then applies the matcher to the reason
 *  (`toThrow(x)` matches the reason as a thrown error). */
function bindRejects(promise, negate) {
  return new Proxy({}, {
    get(_target, name) {
      return async (...args) => {
        try {
          await promise;
        } catch (error) {
          const matcher = matchers(error)[name];
          if (!matcher) throw new TypeError(`vitest-compat: unsupported matcher '${String(name)}'`);
          const [pass, message] =
            name === "toThrow" ? [throwMatches(error, args[0]), `expected rejection ${show(error?.message ?? error)} to match ${String(args[0])}`] : matcher(...args);
          if (pass === negate) assert.fail(negate ? `NOT: ${message}` : message);
          return;
        }
        assert.fail("expected a rejection, got a resolution");
      };
    },
  });
}

/** `message`, like vitest's, prefixes the failure message of the matcher it guards. */
export function expect(actual, message) {
  const positive = bindMatchers(actual, false, message);
  return new Proxy(positive, {
    get(target, name) {
      if (name === "not") return bindMatchers(actual, true, message);
      if (name === "rejects") return bindRejects(actual, false);
      return target[name];
    },
  });
}

expect.stringContaining = (substring) => ({
  [ASYMMETRIC]: true,
  matches: (actual) => typeof actual === "string" && actual.includes(substring),
  description: `StringContaining ${show(substring)}`,
});

const stubbedGlobals = new Map();

/** Steps fake time forward, letting awaited continuations run between timer firings. */
async function advanceTimersByTimeAsync(ms) {
  const step = 50;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    mock.timers.tick(Math.min(step, ms - elapsed));
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
}

export const vi = {
  fn(impl) {
    let implementation = impl;
    const state = { calls: [] };
    const fn = (...args) => {
      state.calls.push(args);
      return implementation?.(...args);
    };
    Object.defineProperty(fn, "mock", { value: state });
    fn.mockResolvedValue = (value) => {
      implementation = async () => value;
      return fn;
    };
    fn.mockClear = () => {
      state.calls = [];
      return fn;
    };
    return fn;
  },
  stubGlobal(name, value) {
    if (!stubbedGlobals.has(name)) stubbedGlobals.set(name, globalThis[name]);
    globalThis[name] = value;
  },
  unstubAllGlobals() {
    for (const [name, original] of stubbedGlobals) globalThis[name] = original;
    stubbedGlobals.clear();
  },
  useFakeTimers() {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  },
  useRealTimers() {
    mock.timers.reset();
  },
  advanceTimersByTimeAsync,
};

/**
 * Replaces the global `fetch` with one that throws for the rest of this test file, and fails the file
 * in an `after` hook if anything called it. `vi.unstubAllGlobals` restores to this guard, not to the
 * real `fetch`, because the guard is what was installed when the first stub was taken.
 */
export function installNetworkGuard() {
  const reached = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    reached.push(url);
    throw new Error(`network guard: unstubbed fetch to ${url}`);
  };
  after(() => assert.deepEqual(reached, [], "no test may reach the real network"));
}
