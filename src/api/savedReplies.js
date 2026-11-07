import client from './client.js';

export async function listSavedReplies() {
  const { data } = await client.get('/saved-replies');
  return data.data || [];
}

export async function createSavedReply(payload) {
  const { data } = await client.post('/saved-replies', payload);
  return data.data;
}

export async function updateSavedReply(id, payload) {
  const { data } = await client.put(`/saved-replies/${encodeURIComponent(id)}`, payload);
  return data.data;
}

export async function deleteSavedReply(id) {
  const { data } = await client.delete(`/saved-replies/${encodeURIComponent(id)}`);
  return data.data;
}
