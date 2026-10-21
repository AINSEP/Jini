import * as nodeFs from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OAuthRandomBytes } from './ports.js';
import type { RegistrationCacheFilePort } from './file-registration-cache.js';
/** The `node:fs/promises` operations this adapter performs; defaults to the real module. */
export type NodeRegistrationCacheFs = Pick<typeof nodeFs, 'mkdir' | 'open' | 'readFile' | 'rename' | 'unlink'>;
/** Optional Node file adapter: exclusive temporary file, 0600 from creation, fsync then atomic rename. */
// A registration may contain a confidential client's secret. Set owner-only permissions at file
// creation: chmod after rename would leave a window where the first secret bytes were readable.
export function createNodeRegistrationCacheFileIO(deps: {
    readonly randomBytesFn: OAuthRandomBytes;
}, { fs = nodeFs }: { readonly fs?: NodeRegistrationCacheFs } = {}): RegistrationCacheFilePort {
    const { mkdir, open, readFile, rename, unlink } = fs;
    return {
        async read({ filePath }) {
            try {
                return await readFile(filePath, 'utf8');
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return null;
                throw error;
            }
        },
        async writeAtomic({ filePath, content }) {
            await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
            const temporary = `${filePath}.${Buffer.from(deps.randomBytesFn({
                byteLength: 16
            })).toString('hex')}.tmp`;
            const handle = await open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(content, 'utf8');
                await handle.sync();
                await handle.close();
                await rename(temporary, filePath);
            }
            finally {
                await handle.close();
                await unlink(temporary).catch(error => {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw error;
                });
            }
        },
    };
}
