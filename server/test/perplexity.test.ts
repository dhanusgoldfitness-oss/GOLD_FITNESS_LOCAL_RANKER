import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PERPLEXITY_API_KEY = 'test-key-not-real';
const { webSearch, dedupeByUrl, urlKey } = await import('../src/lib/perplexity.js');

const realFetch = globalThis.fetch;
const reply = (status: number, json: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json', ...headers } });
const mock = (...rs: Response[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return rs.shift()!; }) as typeof fetch;
  return calls;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

const hit = (url: string, title = 't') => ({ title, url, snippet: 's', date: null, last_updated: null });

test('urlKey ignores scheme, www, trailing slash and hash', () => {
  assert.equal(urlKey('https://www.Example.com/a/#x'), urlKey('http://example.com/a'));
});
test('dedupeByUrl keeps the first, best-ranked entry', () => {
  const r = dedupeByUrl([hit('https://a.com/x', '1'), hit('https://www.a.com/x/', '2'), hit('https://b.com', '3')]);
  assert.deepEqual(r.map((x) => x.title), ['1', '3']);
});
test('sends documented request shape and parses results', async () => {
  const calls = mock(reply(200, { id: 'abc', results: [hit('https://a.com')] }));
  const out = await webSearch({ query: ['gym near me', 'best gym kochi'], max_results: 5, country: 'IN' });
  assert.equal(calls[0].url, 'https://api.perplexity.ai/search');
  assert.equal((calls[0].init.headers as any).Authorization, 'Bearer test-key-not-real');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { query: ['gym near me', 'best gym kochi'], max_results: 5, country: 'IN' });
  assert.equal(out.id, 'abc');
  assert.equal(out.results[0].url, 'https://a.com');
});
test('flattens and dedupes multi-query results', async () => {
  mock(reply(200, { id: 'x', results: [[hit('https://a.com'), hit('https://b.com')], [hit('https://a.com/'), hit('https://c.com')]] }));
  const out = await webSearch({ query: ['one', 'two'] });
  assert.deepEqual(out.results.map((r) => r.url), ['https://a.com', 'https://b.com', 'https://c.com']);
});
test('retries 429 once then succeeds (honours Retry-After)', async () => {
  const calls = mock(reply(429, {}, { 'retry-after': '0' }), reply(200, { id: 'x', results: [hit('https://a.com')] }));
  const out = await webSearch({ query: 'q1' });
  assert.equal(calls.length, 2);
  assert.equal(out.results.length, 1);
});
test('401 becomes a key error without leaking the key', async () => {
  mock(reply(401, {}));
  await assert.rejects(() => webSearch({ query: 'q1' }), (e: any) => e.status === 502 && !String(e.message).includes('test-key-not-real'));
});
test('422 maps to a validation error', async () => {
  mock(reply(422, { detail: [{ loc: ['body', 'country'], msg: 'bad', type: 'x' }] }));
  await assert.rejects(() => webSearch({ query: 'q1' }), (e: any) => e.status === 400 && /country/.test(e.message));
});
test('rejects bad input before any network call', async () => {
  const calls = mock();
  await assert.rejects(() => webSearch({ query: '' }));
  await assert.rejects(() => webSearch({ query: Array(6).fill('q') }));
  await assert.rejects(() => webSearch({ query: 'q', max_results: 50 }));
  await assert.rejects(() => webSearch({ query: 'q', search_domain_filter: ['a.com', '-b.com'] }));
  assert.equal(calls.length, 0);
});
