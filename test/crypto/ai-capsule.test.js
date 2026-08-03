import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { buildCapsule } from '../../src/utils/aiCapsule.js';

// jsdom-free Node environment: expose Web Crypto for aiCapsule hashing.
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

test('buildCapsule returns contentHash without requiring server plaintext fields', async () => {
  const secret = `SECRET_AI_CAPSULE_${Date.now()}`;
  const capsule = await buildCapsule({
    messagesTexts: [secret, 'second line'],
    purpose: 'assist',
  });

  assert.equal(typeof capsule.plaintextJson, 'string');
  assert.equal(typeof capsule.contentHash, 'string');
  assert.match(capsule.contentHash, /^[0-9a-f]{64}$/);
  assert.ok(capsule.plaintextJson.includes(secret));

  // Server receipt payload must be hash-only — never ship plaintextJson fields.
  const serverReceipt = {
    contentHash: capsule.contentHash,
    messageCount: 2,
    purpose: 'assist',
  };
  assert.equal(serverReceipt.plaintext, undefined);
  assert.equal(serverReceipt.content, undefined);
  assert.equal(serverReceipt.plaintextJson, undefined);
  assert.equal(JSON.stringify(serverReceipt).includes(secret), false);
});

test('FAIL GATE: different plaintext yields different contentHash', async () => {
  const a = await buildCapsule({ messagesTexts: ['alpha'], purpose: 'assist' });
  const b = await buildCapsule({ messagesTexts: ['beta'], purpose: 'assist' });
  assert.notEqual(a.contentHash, b.contentHash);
});
