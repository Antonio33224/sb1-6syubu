import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cabeçalhos de segurança aplicados a todas as respostas.
 * (CSP completa fica como próximo passo — ver SECURITY_AUDIT.md — porque o site
 * carrega Supabase, o SDK/iframes do Mercado Pago, tiles do mapa e imagens externas.)
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Câmera só no próprio site (check-in por QR Code na portaria). Microfone desligado.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(self), usb=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: root,
  // exceljs só roda no servidor (relatórios).
  serverExternalPackages: ['exceljs'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Respostas de API nunca vão para cache compartilhado.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
