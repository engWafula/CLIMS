import type { NextConfig } from 'next';

/*
 * Response headers for every page and file. The Content-Security-Policy is not
 * here: it carries a per-request nonce, so it is set in src/proxy.ts.
 */
const securityHeaders = [
  // Never let a response be reinterpreted as another content type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The app is never meant to be embedded; this blocks clickjacking.
  // (frame-ancestors in the policy says the same to modern browsers.)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Send only the origin, not the full path, to other sites.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app uses none of these device features, so no script may ask for them,
  // except location: the hotspot map can centre on where a field user stands.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // The end-to-end tests (playwright.config.ts) build into `.next-e2e`, so their dev server can
  // run while a developer's `next dev` holds the lock in `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  // `next dev` refuses its hot-reload socket to pages opened on any host but localhost, and such a
  // page never hydrates. ALLOWED_DEV_ORIGINS (comma-separated hosts, e.g. the LAN IP in
  // docs/clients.md) lets those hosts in. A production build ignores it.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
  turbopack: {
    root: __dirname,
  },
  headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  redirects() {
    // The bare address has no screen of its own; it leads to the default
    // workspace (HOME_PATH in src/navigation/paths.ts; a test keeps them equal).
    return [
      { source: '/', destination: '/moh', permanent: false },
      // Registering stock moved into a panel on the stock page; the query (`?store=`) is kept.
      {
        source: '/warehouse/stock/receive',
        destination: '/warehouse/stock?register=1',
        permanent: false,
      },
      // The Dispatch tab became each request's own page; old links keep working.
      {
        source: '/dcfp/stockouts/dispatch',
        has: [{ type: 'query', key: 'report', value: '(?<report>[^&]+)' }],
        destination: '/dcfp/stockouts/:report',
        permanent: false,
      },
      { source: '/dcfp/stockouts/dispatch', destination: '/dcfp/stockouts', permanent: false },
    ];
  },
  rewrites() {
    const backend = process.env.BACKEND_URL || 'http://localhost:8080';
    return ['api', 'docs', 'health'].map((prefix) => ({
      source: `/${prefix}/:path*`,
      destination: `${backend}/${prefix}/:path*`,
    }));
  },
};

export default nextConfig;
