/**
 * A stand-in for the CLIMS API, for developing the UI without a backend.
 *
 *   npm run mock-api                 # realistic demo data
 *   MOCK_DATA=worst npm run mock-api # the awkward data real systems contain
 *   MOCK_DATA=empty npm run mock-api # nothing recorded yet
 *   MOCK_DATA=scale npm run mock-api # the demo plus a national store's volume of stock
 *
 * Then, in another terminal:
 *   BACKEND_URL=http://127.0.0.1:8787 npm run dev
 *
 * The dev server forwards /api/* here with the path unchanged, as the Nginx
 * gateway does for the real API, so the /api/v1 prefix is accepted and ignored.
 *
 * Sign in with any email, username or phone; the password "wrong" is rejected, anything else
 * is accepted. MOCK_FAIL=<resource> (e.g. `users`) makes that resource return
 * a 500 so error states can be looked at. MOCK_DELAY sets latency in ms.
 *
 * Replies use the Go API's shapes. Data lives in memory and resets on
 * restart. This file is a development tool and is never part of a build.
 *
 * Node runs it directly by stripping the types (`--experimental-strip-types`),
 * so it may only use erasable TypeScript: no enums, namespaces or parameter
 * properties, and type-only imports marked `type`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { handleDcfp, seedDcfp } from './mock/dcfp.mts';
import { handleInventory, seedInventory, type SummaryOrder } from './mock/inventory.mts';
import { handleFulfilment, seedFulfilment } from './mock/fulfilment.mts';
import { handleMoh, seedMoh } from './mock/moh.mts';
import { handleOnboarding, seedOnboarding } from './mock/onboarding.mts';
import { handleAdmin, handleAuth, seedAdmin, signedInUser } from './mock/admin.mts';
import { handleAnalytics, seedAnalytics } from './mock/analytics.mts';
import { handleReports, seedReports } from './mock/reports.mts';
import { handleHotspots, seedHotspotsMock } from './mock/hotspots.mts';

type Body = Record<string, unknown>;
interface Reply {
  status: number;
  body: unknown;
}

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const DELAY_MS = Number(process.env.MOCK_DELAY ?? 250);
const DATASET = process.env.MOCK_DATA ?? 'demo';
const TOKEN = 'mock-token';
// The access token never expires here, so a refresh hands back the same one.
const REFRESH_TOKEN = 'mock-refresh-token';

const organizationUnits = [
  { id: 1, name: 'Ministry of Health' },
  { id: 2, name: 'Kampala Capital City Authority' },
  { id: 3, name: 'Gulu District Health Office' },
  { id: 4, name: 'Mbarara Regional Referral Hospital' },
];

/**
 * `demo` is realistic data; `worst` puts the values that break layouts first
 * (missing fields, zero coordinates, long text); `empty` has nothing recorded;
 * `scale` is the demo with a national store's volume of stock (hundreds of
 * products, a thousand batches, a year of movements) at NMS.
 */
const datasets = ['demo', 'worst', 'empty', 'scale'] as const;

function isDatasetName(name: string): name is (typeof datasets)[number] {
  return (datasets as readonly string[]).includes(name);
}

if (!isDatasetName(DATASET)) {
  console.error(`Unknown MOCK_DATA "${DATASET}". Use one of: ${datasets.join(', ')}.`);
  process.exit(1);
}

/**
 * Puts every resource back to its seeded state: at start-up, and on `POST /__reset`, which the
 * end-to-end tests (`e2e/`) call before each test so no test sees another's changes.
 */
function seedAll(dataset: (typeof datasets)[number]): void {
  seedHotspotsMock(dataset);
  seedFulfilment(dataset);
  // Stock first: the order seed adds the reservations of its confirmed orders to it.
  seedInventory(dataset);
  seedDcfp(dataset);
  seedMoh(dataset);
  seedOnboarding();
  seedAdmin(dataset);
  seedReports(dataset);
  seedAnalytics(dataset);
}
seedAll(DATASET);
const lookups: Record<string, readonly unknown[]> = { organizationUnits };

const reply = (status: number, body: unknown): Reply => ({ status, body });

/** The order mock's orders with their history, for the stock summary. */
function summaryOrders(): SummaryOrder[] {
  const none = new URLSearchParams();
  const data = (answer: Reply | null) =>
    ((answer?.body as { data?: unknown } | undefined)?.data ?? []) as Record<string, unknown>[];
  return data(handleDcfp('GET', ['orders'], {}, none)).map((order) => ({
    ...(order as unknown as SummaryOrder),
    events: data(
      handleDcfp('GET', ['orders', String(order.id), 'events'], {}, none),
    ) as unknown as SummaryOrder['events'],
  }));
}

function send(response: ServerResponse, { status, body }: Reply): void {
  // A text body is a file download (a report's CSV); everything else is the JSON envelope.
  if (typeof body === 'string') {
    response.writeHead(status, { 'Content-Type': 'text/csv; charset=utf-8' });
    response.end(body);
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function isBody(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request: IncomingMessage): Promise<Body> {
  const chunks: Uint8Array[] = [];
  // No encoding is set on the request, so it yields raw bytes.
  for await (const chunk of request as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  const parsed: unknown = text ? JSON.parse(text) : {};
  return isBody(parsed) ? parsed : {};
}

/** Answers one request. Every path returns a reply; nothing here writes to the socket. */
async function route(request: IncomingMessage): Promise<Reply> {
  const body = await readJson(request).catch((): Body => ({}));
  const { pathname } = new URL(request.url ?? '/', 'http://mock');
  const parts = pathname
    .replace(/^\/api(?:\/v1)?(?=\/|$)/, '')
    .split('/')
    .slice(1);
  const [resource = '', id] = parts;
  if (resource === '__reset' && request.method === 'POST' && isDatasetName(DATASET)) {
    seedAll(DATASET);
    return reply(200, { success: true, data: null });
  }
  await sleep(DELAY_MS);

  if (process.env.MOCK_FAIL === resource) {
    return reply(500, { message: 'SQLSTATE[HY000]: internal detail that must not be shown' });
  }

  // Same shape as the Go API's POST /api/v1/auth/login.
  if (resource === 'auth' && id === 'login' && request.method === 'POST') {
    if (body.password === 'wrong') {
      return reply(401, { success: false, message: 'invalid credentials' });
    }
    return reply(200, {
      success: true,
      message: 'login successful',
      data: {
        token: TOKEN,
        refresh_token: REFRESH_TOKEN,
        token_type: 'Bearer',
        expires_in: 86400,
        user: signedInUser(
          typeof body.login === 'string' && body.login.includes('@') ? body.login : null,
        ),
      },
    });
  }
  // Same shape as the Go API's POST /api/v1/auth/refresh. Anonymous: the access token may have expired.
  if (resource === 'auth' && id === 'refresh' && request.method === 'POST') {
    if (body.refresh_token !== REFRESH_TOKEN) {
      return reply(401, { success: false, message: 'invalid refresh token' });
    }
    return reply(200, {
      success: true,
      data: { token: TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer', expires_in: 900 },
    });
  }
  // Invitation activation is anonymous, so it is answered before the token check.
  const onboarding = handleOnboarding(request.method ?? 'GET', parts, body);
  if (onboarding) return onboarding;
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    return reply(401, { message: 'Unauthenticated.' });
  }
  if (resource === 'auth' && id === 'logout' && request.method === 'POST') {
    return reply(200, { success: true, message: 'logged out', data: null });
  }
  // The signed-in user and their devices, in the Go API's shapes.
  const auth = handleAuth(request.method ?? 'GET', parts, request.headers['user-agent'] ?? null);
  if (auth) return auth;
  // Users, roles and permissions in the Go API's shapes; answered before the legacy lookups.
  const admin = handleAdmin(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (admin) return admin;
  if (Object.hasOwn(lookups, resource)) return reply(200, lookups[resource]);

  // The DCFP's stockout reports and warehouse orders, and the inbox, in the Go API's shapes.
  const dcfp = handleDcfp(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (dcfp) return dcfp;
  const inventory = handleInventory(
    request.method ?? 'GET',
    parts,
    new URL(request.url ?? '/', 'http://mock').searchParams,
    body,
    summaryOrders,
  );
  if (inventory) return inventory;
  const fulfilment = handleFulfilment(request.method ?? 'GET', parts, body);
  if (fulfilment) return fulfilment;
  const national = handleMoh(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (national) return national;
  // Programme reports and analytics (`/reports/*`), calculated from a year of generated activity.
  const analytics = handleAnalytics(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (analytics) return analytics;
  const reports = handleReports(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (reports) return reports;
  const hotspots = handleHotspots(
    request.method ?? 'GET',
    parts,
    body,
    new URL(request.url ?? '/', 'http://mock').searchParams,
  );
  if (hotspots) return hotspots;

  return reply(404, { message: 'Not found' });
}

const server = createServer((request, response) => {
  route(request)
    .then((answer) => {
      send(response, answer);
    })
    .catch((error: unknown) => {
      console.error(error);
      send(response, reply(500, { message: 'Mock API error' }));
    });
});

// Loopback only: this server has no real authentication and must not be reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`CLIMS mock API (${DATASET} data) on http://127.0.0.1:${PORT}`);
});
