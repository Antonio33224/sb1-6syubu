import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cabeçalhos de segurança aplicados a todas as respostas.
 * (CSP completa fica como próximo passo — ver SECURITY_AUDIT.md — porque o site
 * carrega Supabase, OpenAI Realtime/WebRTC, tiles do mapa e imagens externas.)
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Microfone só para o próprio site (concierge de voz); câmera e pagamento desligados.
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(self), payment=(), usb=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: root,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Respostas de API nunca vão para cache compartilhado.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
  // O concierge em texto (/classify-ai) virou o assistente de voz flutuante.
  async redirects() {
    return [{ source: '/classify-ai/:path*', destination: '/', statusCode: 301 }];
  },
};

export default nextConfig;
