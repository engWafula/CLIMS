import { workspaces } from '../../src/navigation/workspaces';

/*
 * Every signed-in screen, read from the navigation table so the end-to-end checks follow it
 * when routes are added or retired. Detail routes (`[id]`) are opened with a record the mock
 * seeds; a new detail route without a sample here fails `routesToVisit()` loudly.
 */

const SAMPLE_PATHS: Readonly<Record<string, string>> = {
  // MOH reads the DCFP's records nationally: Kisenyi's stockout request and Wakiso's NMS order.
  '/moh/orders/[id]': '/moh/orders/00000000-0000-4000-8302-000000000001',
  '/moh/orders/warehouse/[id]': '/moh/orders/warehouse/00000000-0000-4000-8301-000000000003',
  '/moh/reports/[id]': '/moh/reports/RPT-2610-HS0198',
  '/dcfp/restock/new': '/dcfp/restock/new',
  // The seeded order NMS has dispatched to Wakiso (dev/mock/dcfp.mts).
  '/dcfp/restock/[id]': '/dcfp/restock/00000000-0000-4000-8301-000000000003',
  // Kasenyi Landing Site, a hotspot in dev/mock/hotspots.mts.
  '/dcfp/hotspots/[id]': '/dcfp/hotspots/00000000-0000-4000-8000-000000000009',
  '/dcfp/reports/[id]': '/dcfp/reports/RPT-2610-WAKISO',
  // Kisenyi Landing Site's open stockout report (dev/mock/dcfp.mts).
  '/dcfp/stockouts/[id]': '/dcfp/stockouts/00000000-0000-4000-8302-000000000001',
  // Mukono's order NMS has reserved, waiting to be dispatched (dev/mock/dcfp.mts).
  '/warehouse/requests/[id]': '/warehouse/requests/00000000-0000-4000-8301-000000000008?store=NMS',
  '/warehouse/reports/[id]': '/warehouse/reports/RPT-2610-NMS?store=NMS',
};

export interface RouteToVisit {
  /** The address to open. */
  path: string;
  /** The page's heading: its title, or the detail label. */
  heading: string;
  /** A file-name-safe name, e.g. `dcfp-orders-id`. */
  slug: string;
}

function slugOf(pattern: string): string {
  return (
    pattern
      .replace(/^\//, '')
      .replace(/\[(\w+)\]/g, '$1')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/-$/, '') || 'root'
  );
}

export function routesToVisit(): RouteToVisit[] {
  const routes: RouteToVisit[] = [];
  for (const workspace of workspaces) {
    for (const section of workspace.sections) {
      for (const item of section.items) {
        for (const page of item.pages) {
          routes.push({ path: page.path, heading: page.title, slug: slugOf(page.path) });
        }
        for (const detail of item.details ?? []) {
          const path = SAMPLE_PATHS[detail.path];
          if (!path) {
            throw new Error(`Add a sample record for ${detail.path} to e2e/support/routes.ts.`);
          }
          routes.push({ path, heading: detail.label, slug: slugOf(detail.path) });
        }
      }
    }
  }
  return routes;
}
