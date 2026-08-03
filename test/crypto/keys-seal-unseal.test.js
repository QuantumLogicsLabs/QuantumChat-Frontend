import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeySet,
  sealMessage,
  unsealMessage,
  KEY_SET_SIZE,
} from '../../src/crypto/keys.js';

test('KEY_SET_SIZE is 5 (X5 pool)', () => {
  assert.equal(KEY_SET_SIZE, 5);
  assert.equal(generateKeySet().length, 5);
});

test('seal/unseal round-trip with matching secret key', () => {
  const [recipient] = generateKeySet(1);
  const plaintext = `SECRET_FE_ROUNDTRIP_${Date.now()}`;
  const envelope = sealMessage(plaintext, recipient.publicKey);

  assert.equal(typeof envelope.ciphertext, 'string');
  assert.equal(typeof envelope.nonce, 'string');
  assert.equal(typeof envelope.ephemeralPublicKey, 'string');
  assert.equal(envelope.targetPublicKey, recipient.publicKey.toLowerCase());
  assert.equal(unsealMessage(envelope, recipient.secretKey), plaintext);
});

test('FAIL GATE: wrong private key cannot open sealed envelope', () => {
  const [recipient] = generateKeySet(1);
  const [attacker] = generateKeySet(1);
  const plaintext = `SECRET_FE_WRONGKEY_${Date.now()}`;
  const envelope = sealMessage(plaintext, recipient.publicKey);

  assert.equal(unsealMessage(envelope, attacker.secretKey), null);
  assert.equal(unsealMessage(envelope, envelope.targetPublicKey), null);
  assert.equal(unsealMessage(envelope, envelope.ephemeralPublicKey), null);
});

test('FAIL GATE: ciphertext does not trivially embed plaintext', () => {
  const [recipient] = generateKeySet(1);
  const plaintext = `SECRET_FE_EMBED_${Date.now()}`;
  const envelope = sealMessage(plaintext, recipient.publicKey);
  const json = JSON.stringify(envelope);
  assert.equal(json.includes(plaintext), false);
  assert.equal(envelope.ciphertext.includes(Buffer.from(plaintext).toString('base64')), false);
});
