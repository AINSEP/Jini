export declare const packages: string;
export declare function fixture(prefix: string): string;
export declare function pack(dir: string, name: string): void;
export declare function copyPackage(dir: string, name: string, source: string): void;
export declare function copyRuntimeTree(dir: string, name: string, source: string, seen?: Set<string>): void;
export declare function run(dir: string, source: string): import("child_process").SpawnSyncReturns<string>;
//# sourceMappingURL=packed-fixture.d.ts.map