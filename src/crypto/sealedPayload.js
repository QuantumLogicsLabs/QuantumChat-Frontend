/**
 * Pure helpers for building sealed outbound payloads.
 * Keeps plaintext `text` / `content` fields out of API bodies.
 */

const FORBIDDEN_PLAINTEXT_KEYS = new Set(['text', 'content', 'plaintext', 'body', 'message', 'sdp', 'candidate']);

export function assertSealedEnvelope(envelope, label = 'envelope') {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error(`${label} must be an object`);
  }
  for (const key of ['ciphertext', 'nonce', 'ephemeralPublicKey', 'targetPublicKey']) {
    if (typeof envelope[key] !== 'string' || !envelope[key]) {
      throw new Error(`${label}.${key} must be a non-empty string`);
    }
  }
}

/**
 * Build a DM POST body that can only carry sealed envelopes (plus safe metadata).
 */
export function buildSealedDmBody({ to, forRecipient, forSender, ...extras } = {}) {
  if (!to) throw new Error('to is required');
  assertSealedEnvelope(forRecipient, 'forRecipient');
  assertSealedEnvelope(forSender, 'forSender');

  const body = { to, forRecipient, forSender };
  for (const [key, value] of Object.entries(extras)) {
    if (FORBIDDEN_PLAINTEXT_KEYS.has(key)) continue;
    if (value !== undefined) body[key] = value;
  }
  return body;
}

/** True if an object (recursively) contains forbidden plaintext chat fields. */
export function containsForbiddenPlaintextFields(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => containsForbiddenPlaintextFields(item, depth + 1));
  }
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_PLAINTEXT_KEYS.has(key) && value != null && value !== '') return true;
    if (containsForbiddenPlaintextFields(value, depth + 1)) return true;
  }
  return false;
}
