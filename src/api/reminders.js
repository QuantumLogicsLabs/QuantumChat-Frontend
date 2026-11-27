import client from './client.js';

/** remindAt: Date or ISO string. Creates a reminder, or reschedules the pending one. */
export async function createReminder({ messageId, remindAt }) {
  const when = remindAt instanceof Date ? remindAt.toISOString() : remindAt;
  const { data } = await client.post('/reminders', { messageId, remindAt: when });
  return data;
}

export async function listReminders(messageId) {
  const { data } = await client.get('/reminders', { params: messageId ? { messageId } : undefined });
  return data;
}

export async function deleteReminder(id) {
  const { data } = await client.delete(`/reminders/${id}`);
  return data;
}
