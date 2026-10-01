import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const config: NextConfig = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  poweredByHeader: false,
  // This workspace reproduced numbered duplicate files in the persistent build cache.
  experimental: { turbopackFileSystemCacheForBuild: false, turbopackFileSystemCacheForDev: false },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }];
  },
};

export default config;
