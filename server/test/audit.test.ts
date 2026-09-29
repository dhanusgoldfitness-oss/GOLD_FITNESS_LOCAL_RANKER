import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../src/lib/audit.js';
import { encrypt, decrypt, signState, verifyState } from '../src/lib/crypto.js';


const full = {
  title: 'DGF', phone: '1', website: 'x', address: 'a', primaryCategory: 'Gym', additionalCategories: 2,
  description: 'x'.repeat(300), hasHours: true, serviceCount: 6, photoCount: 30, reviewCount: 40, unansweredReviews: 0, avgRating: 4.8, postsLast30d: 5,
};

test('perfect profile scores 100', () => assert.equal(runAudit(full).score, 100));
test('audit is deterministic', () => assert.deepEqual(runAudit(full), runAudit(full)));
test('empty profile scores low and lists high-priority fixes first', () => {
  const r = runAudit({});
  assert.ok(r.score < 25);
  assert.equal(r.recommendations[0].priority, 'high');
});
test('unknown data is excluded, never counted as zero', () => {
  const r = runAudit({ ...full, photoCount: null, reviewCount: null, unansweredReviews: null, avgRating: null, postsLast30d: null });
  assert.equal(r.score, 100);
  assert.equal(r.unknown.length, 5);
});
test('breakdown explains lost points', () => {
  const r = runAudit({ ...full, description: '' });
  assert.ok(r.recommendations.find((x) => x.key === 'description')!.pointsLost === 10);
});

test('token encryption round-trips and is non-deterministic', () => {
  const c1 = encrypt('refresh-token'), c2 = encrypt('refresh-token');
  assert.notEqual(c1, c2);
  assert.equal(decrypt(c1), 'refresh-token');
  assert.throws(() => decrypt(c1.slice(0, -4) + 'AAAA'));
});
test('oauth state: valid, tampered, garbage', () => {
  const st = signState('user-1');
  assert.equal(verifyState(st), 'user-1');
  const [b, sig] = st.split('.');
  assert.equal(verifyState(b + '.' + sig.slice(0, -2) + 'xx'), null);
  assert.equal(verifyState('garbage'), null);
  assert.equal(verifyState(signState('user-1', -1000)), null);   // expired
});
