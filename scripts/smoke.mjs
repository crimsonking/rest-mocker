// End-to-end smoke test (task 6.1): exercises the full mock lifecycle over
// real HTTP against a running production build.
//   npm run build && PORT=3100 npm start   # then, in another shell:
//   npm run smoke                          # target override: MOCK_BASE=...
let failures = 0;
let checks = 0;

const BASE = process.env.MOCK_BASE ?? 'http://127.0.0.1:3100';

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ok  ${name}`);
    return true;
  }
  failures++;
  console.error(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  return false;
}

function eq(name, actual, expected) {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function req(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function register(def) {
  const res = await req('POST', '/_mocks', def);
  if (res.status !== 201) {
    throw new Error(`registration failed for ${def.method} ${def.uri}: ${res.text}`);
  }
  return res.json;
}

async function main() {
  console.log(`smoke target: ${BASE}`);

  // Deterministic start: clear seeded/registered mocks.
  eq('clear-all responds 204', (await req('DELETE', '/_mocks')).status, 204);
  eq('store starts empty', (await req('GET', '/_mocks')).json, []);

  // Registration + exact match.
  const ping = await register({ method: 'GET', uri: '/ping', status: 200, body: 'pong' });
  check('registration returns an id', typeof ping.id === 'string' && ping.id.length > 0, ping.id);
  let r = await req('GET', '/ping');
  eq('exact match status', r.status, 200);
  eq('exact match body', r.text, 'pong');
  check(
    'string body gets text/plain',
    (r.headers.get('content-type') ?? '').startsWith('text/plain'),
    r.headers.get('content-type'),
  );

  // Path parameter and wildcard matching.
  await register({ method: 'GET', uri: '/users/:id', body: { echo: 'user' } });
  await register({ method: 'GET', uri: '/files/*', body: 'wild' });
  eq('param match', (await req('GET', '/users/42')).json, { echo: 'user' });
  eq('wildcard match', (await req('GET', '/files/docs/a/b.png')).text, 'wild');

  // Method mismatch → unmatched JSON 500 naming method and path.
  r = await req('POST', '/ping');
  eq('method mismatch 500', r.status, 500);
  eq('unmatched error names method', r.json?.error?.method, 'POST');
  eq('unmatched error names path', r.json?.error?.path, '/ping');

  // Query string excluded from matching.
  eq('query ignored', (await req('GET', '/ping?verbose=1&x=2')).text, 'pong');

  // Full pre-defined response: status, headers, JSON body.
  await register({
    method: 'POST',
    uri: '/created',
    status: 201,
    headers: { 'X-Trace': 'abc' },
    body: { created: true },
  });
  r = await req('POST', '/created');
  eq('custom status', r.status, 201);
  eq('custom header', r.headers.get('x-trace'), 'abc');
  eq('json body round-trip', r.json, { created: true });

  // Default status when omitted.
  await register({ method: 'GET', uri: '/plain', body: 'text' });
  eq('default status 200', (await req('GET', '/plain')).status, 200);

  // Precedence: exact > param > wildcard, latest registration wins ties.
  await register({ method: 'GET', uri: '/users/me', body: 'me' });
  eq('exact beats param', (await req('GET', '/users/me')).text, 'me');
  eq('param still serves other segments', (await req('GET', '/users/42')).json, { echo: 'user' });
  eq('param beats wildcard', (await req('GET', '/users/7')).json, { echo: 'user' });
  await register({ method: 'GET', uri: '/ping', body: 'pong2' });
  eq('latest registration wins', (await req('GET', '/ping')).text, 'pong2');

  // Delete by id.
  const ping2 = (await req('GET', '/_mocks')).json.find(
    (m) => m.uri === '/ping' && m.body === 'pong2',
  );
  eq('delete by id 204', (await req('DELETE', `/_mocks/${ping2.id}`)).status, 204);
  eq('older identical mock serves again', (await req('GET', '/ping')).text, 'pong');
  eq('re-delete same id 404', (await req('DELETE', `/_mocks/${ping2.id}`)).status, 404);
  r = await req('DELETE', '/_mocks/does-not-exist');
  eq('unknown id 404', r.status, 404);
  check('unknown id error is JSON', typeof r.json?.error?.message === 'string', r.text);

  // Invalid registrations are rejected and change nothing.
  const countBefore = (await req('GET', '/_mocks')).json.length;
  r = await req('POST', '/_mocks', { uri: '/x' });
  eq('missing method 400', r.status, 400);
  check('error details name the method field', JSON.stringify(r.json).includes('"method"'), r.text);
  eq('reserved uri 400', (await req('POST', '/_mocks', { method: 'GET', uri: '/_mocks/x' })).status, 400);
  eq('malformed json 400', (await fetch(`${BASE}/_mocks`, { method: 'POST', body: '{not json' })).status, 400);
  eq('store unchanged after rejections', (await req('GET', '/_mocks')).json.length, countBefore);

  // Schema features: bodySchema enforcement over HTTP.
  await register({
    method: 'POST',
    uri: '/sm-orders',
    status: 201,
    body: { ok: true },
    bodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  });
  const ordersCount = (await req('GET', '/_mocks')).json.length;
  r = await req('POST', '/sm-orders', { name: 42 });
  eq('bodySchema bad body 400', r.status, 400);
  eq('bodySchema details name the instance path', r.json?.error?.details?.[0]?.field, '/name');
  eq('bodySchema absent body 400', (await req('POST', '/sm-orders')).status, 400);
  eq('failed body calls register nothing', (await req('GET', '/_mocks')).json.length, ordersCount);
  r = await req('POST', '/sm-orders', { name: 'widget' });
  eq('bodySchema good body 201', r.status, 201);
  eq('bodySchema good body serves the canned response', r.json, { ok: true });

  // Schema features: responseSchema generation over HTTP.
  await register({
    method: 'GET',
    uri: '/sm-gen',
    responseSchema: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    },
  });
  const gen1 = await req('GET', '/sm-gen');
  const gen2 = await req('GET', '/sm-gen');
  eq('responseSchema first call 200', gen1.status, 200);
  eq('responseSchema second call 200', gen2.status, 200);
  check(
    'responseSchema serves application/json',
    (gen1.headers.get('content-type') ?? '').startsWith('application/json'),
    gen1.headers.get('content-type'),
  );
  check(
    'responseSchema bodies conform on both calls',
    Number.isInteger(gen1.json?.id) &&
      typeof gen1.json?.name === 'string' &&
      Number.isInteger(gen2.json?.id) &&
      typeof gen2.json?.name === 'string',
    `${gen1.text} / ${gen2.text}`,
  );
  check('responseSchema generates fresh data per call', gen1.text !== gen2.text, `${gen1.text} vs ${gen2.text}`);

  // Schema registration rejections change nothing.
  const schemaCountBefore = (await req('GET', '/_mocks')).json.length;
  r = await req('POST', '/_mocks', { method: 'POST', uri: '/sm-bad', bodySchema: { type: 'nope' } });
  eq('invalid bodySchema 400', r.status, 400);
  check('invalid bodySchema names the field', JSON.stringify(r.json).includes('"bodySchema"'), r.text);
  r = await req('POST', '/_mocks', { method: 'GET', uri: '/sm-bad', responseSchema: { type: 'nope' } });
  eq('invalid responseSchema 400', r.status, 400);
  check(
    'invalid responseSchema names the field',
    JSON.stringify(r.json).includes('"responseSchema"'),
    r.text,
  );
  r = await req('POST', '/_mocks', {
    method: 'GET',
    uri: '/sm-bad',
    body: { a: 1 },
    responseSchema: { type: 'object' },
  });
  eq('body+responseSchema conflict 400', r.status, 400);
  check(
    'conflict error names both fields',
    /cannot be combined/.test(r.json?.error?.details?.[0]?.message ?? ''),
    r.text,
  );
  eq('store unchanged after schema rejections', (await req('GET', '/_mocks')).json.length, schemaCountBefore);

  // Reserved prefix: admin API owns it; catch-all never serves mocks there.
  check('GET /_mocks is the admin list', Array.isArray((await req('GET', '/_mocks')).json));
  eq('unknown /_mocks subpath 500', (await req('GET', '/_mocks/a/b')).status, 500);
  eq('PUT /_mocks 405', (await req('PUT', '/_mocks')).status, 405);
  eq('GET /_mocks/{id} 405', (await req('GET', `/_mocks/${ping.id}`)).status, 405);

  // HEAD strictness (recorded assumption: no GET→HEAD fallback).
  await register({ method: 'GET', uri: '/h', body: 'get-only' });
  eq('HEAD does not match GET mock', (await req('HEAD', '/h')).status, 500);
  await register({ method: 'HEAD', uri: '/h', status: 204, headers: { 'X-H': '1' } });
  const headRes = await fetch(`${BASE}/h`, { method: 'HEAD' });
  eq('HEAD mock status', headRes.status, 204);
  eq('HEAD mock header', headRes.headers.get('x-h'), '1');

  // Call statistics lifecycle (starts from a reset so earlier traffic does not leak in).
  eq('stats reset 204', (await req('DELETE', '/_mocks/stats')).status, 204);
  await register({ method: 'GET', uri: '/stats-ping', body: 'ok' });
  const callAs = (path, ua) => fetch(`${BASE}${path}`, { headers: { 'user-agent': ua } });
  await callAs('/stats-ping', 'smoke-a');
  await callAs('/stats-ping', 'smoke-a');
  await callAs('/stats-ping', 'smoke-b');
  await callAs('/stats-missing', 'smoke-a');
  const stats = (await req('GET', '/_mocks/stats')).json;
  eq('stats callerHeader', stats?.callerHeader, 'user-agent');
  eq(
    'stats ordered count-desc, ties by uri then caller',
    stats?.entries?.map((e) => [e.method, e.uri, e.matched, e.caller, e.count]),
    [
      ['GET', '/stats-ping', true, 'smoke-a', 2],
      ['GET', '/stats-missing', false, 'smoke-a', 1],
      ['GET', '/stats-ping', true, 'smoke-b', 1],
    ],
  );
  check(
    'stats lastCalledAt is ISO 8601',
    !Number.isNaN(Date.parse(stats?.entries?.[0]?.lastCalledAt)),
    stats?.entries?.[0]?.lastCalledAt,
  );
  eq('stats reset again 204', (await req('DELETE', '/_mocks/stats')).status, 204);
  eq(
    'report empty after reset (stats endpoints do not self-record)',
    (await req('GET', '/_mocks/stats')).json?.entries,
    [],
  );

  // Clear-all finishes the lifecycle.
  eq('final clear-all 204', (await req('DELETE', '/_mocks')).status, 204);
  eq('list empty after clear', (await req('GET', '/_mocks')).json, []);
  eq('previously matched route now 500', (await req('GET', '/ping')).status, 500);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
