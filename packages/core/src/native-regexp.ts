/** Native RegExp.escape is available in Node 24 and modern browsers, but the supported
 * TypeScript 5.8 libraries do not declare it yet. Declare the native contract without a
 * polyfill or a second escaping implementation; hosts must supply the native capability. */
declare global {
  interface RegExpConstructor {
    escape(value: string): string;
  }
}

export {};
