/**
 * On-device inverted index over decrypted message text.
 * Never uploads queries or plaintext — memory only.
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Build an inverted index from decrypted messages.
 * @param {Array<{ id?: string, _id?: string, text?: string|null, timestamp?: *, createdAt?: * }>} messages
 * @returns {{ docs: Map<string, object>, inverted: Map<string, Map<string, number>>, docCount: number }}
 */
export function buildIndex(messages) {
  const docs = new Map();
  const inverted = new Map();

  for (const msg of messages || []) {
    const id = String(msg?.id || msg?._id || '');
    const text = typeof msg?.text === 'string' ? msg.text : '';
    if (!id || !text.trim()) continue;

    const tokens = tokenize(text);
    if (!tokens.length) continue;

    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    docs.set(id, {
      id,
      text,
      timestamp: msg.timestamp || msg.createdAt || null,
      tokenCount: tokens.length,
      tf,
    });

    for (const [token, count] of tf) {
      let posting = inverted.get(token);
      if (!posting) {
        posting = new Map();
        inverted.set(token, posting);
      }
      posting.set(id, count);
    }
  }

  return { docs, inverted, docCount: docs.size };
}

/**
 * Rank documents by token-overlap / TF score (not plain includes()).
 * @param {{ docs: Map, inverted: Map, docCount: number }} index
 * @param {string} query
 * @returns {Array<{ id: string, text: string, timestamp: *, score: number }>}
 */
export function searchIndex(index, query) {
  if (!index?.docs?.size) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  const queryTokens = tokenize(q);
  if (!queryTokens.length) return [];

  const uniqueQuery = [...new Set(queryTokens)];
  const scores = new Map();

  for (const token of uniqueQuery) {
    const posting = index.inverted.get(token);
    if (!posting) continue;
    for (const [docId, tf] of posting) {
      const doc = index.docs.get(docId);
      if (!doc) continue;
      // TF contribution + bonus for matching more distinct query tokens
      const prev = scores.get(docId) || { score: 0, hits: 0 };
      const tfNorm = tf / Math.max(doc.tokenCount, 1);
      scores.set(docId, {
        score: prev.score + tfNorm + 1,
        hits: prev.hits + 1,
      });
    }
  }

  // Prefer docs that cover more of the query; light boost for phrase-ish includes
  const lowerQ = q.toLowerCase();
  const results = [];
  for (const [docId, { score, hits }] of scores) {
    const doc = index.docs.get(docId);
    if (!doc) continue;
    let finalScore = score * (hits / uniqueQuery.length);
    if (doc.text.toLowerCase().includes(lowerQ)) {
      finalScore += 0.5;
    }
    results.push({
      id: doc.id,
      text: doc.text,
      timestamp: doc.timestamp,
      score: finalScore,
    });
  }

  results.sort((a, b) => b.score - a.score || String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return results;
}
