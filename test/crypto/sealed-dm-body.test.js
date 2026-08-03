import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeySet, sealMessage } from '../../src/crypto/keys.js';
import {
  buildSealedDmBody,
  containsForbiddenPlaintextFields,
} from '../../src/crypto/sealedPayload.js';

test('buildSealedDmBody requires sealed envelopes', () => {
  assert.throws(() => buildSealedDmBody({ to: 'u1' }), /forRecipient/);
  assert.throws(
    () => buildSealedDmBody({ to: 'u1', forRecipient: { ciphertext: 'x' }, forSender: {} }),
    /forRecipient|forSender/
  );
});

test('buildSealedDmBody strips plaintext text/content fields', () => {
  const [alice] = generateKeySet(1);
  const [bob] = generateKeySet(1);
  const forRecipient = sealMessage('hello', bob.publicKey);
  const forSender = sealMessage('hello', alice.publicKey);

  const body = buildSealedDmBody({
    to: 'bob-id',
    forRecipient,
    forSender,
    text: 'LEAK',
    content: 'LEAK',
    plaintext: 'LEAK',
    attachmentId: 'att-1',
  });

  assert.equal(body.to, 'bob-id');
  assert.equal(body.attachmentId, 'att-1');
  assert.equal(body.text, undefined);
  assert.equal(body.content, undefined);
  assert.equal(body.plaintext, undefined);
  assert.equal(containsForbiddenPlaintextFields(body), false);
});

test('containsForbiddenPlaintextFields detects nested leaks', () => {
  assert.equal(containsForbiddenPlaintextFields({ forRecipient: { ciphertext: 'x' } }), false);
  assert.equal(containsForbiddenPlaintextFields({ text: 'hi' }), true);
  assert.equal(containsForbiddenPlaintextFields({ nested: { content: 'hi' } }), true);
  assert.equal(containsForbiddenPlaintextFields({ sdp: { type: 'offer' } }), true);
});
