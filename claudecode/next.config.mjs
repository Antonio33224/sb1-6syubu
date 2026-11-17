import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: root,
  // O concierge em texto (/classify-ai) virou o assistente de voz flutuante.
  async redirects() {
    return [{ source: '/classify-ai/:path*', destination: '/', statusCode: 301 }];
  },
};

export default nextConfig;
