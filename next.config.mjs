/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Browsers ignore HSTS over plain http (local use), and honour it on the real HTTPS site.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

export default {
  reactStrictMode: true,
  // Docker: a minimal self-contained server (only the files the app uses). Vercel ignores this and builds its own way.
  output: 'standalone',
  poweredByHeader: false,
  // The API's server libraries stay as normal Node packages (not bundled): database drivers and knex load parts dynamically.
  serverExternalPackages: ['knex', 'pg', 'better-sqlite3', 'express', 'helmet', 'compression', 'cookie-parser', 'express-rate-limit', 'dotenv'],
  // Migrations are read from disk at runtime, so deployments must include them.
  outputFileTracingIncludes: {
    '/api/[...path]': ['./server/src/migrations/**/*'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};
