import client from './client.js';

export async function getUnreadCount() {
  const { data } = await client.get('/notifications/unread-count');
  return data?.data?.count ?? 0;
}

export async function listNotifications({ before, limit = 30, unreadOnly = false } = {}) {
  const { data } = await client.get('/notifications', {
    params: {
      ...(before ? { before } : {}),
      limit,
      ...(unreadOnly ? { unread: 'true' } : {}),
    },
  });
  return { items: data?.data || [], hasMore: Boolean(data?.meta?.hasMore) };
}

export async function markNotificationsRead(ids) {
  if (!ids || !ids.length) return 0;
  const { data } = await client.post('/notifications/read', { ids });
  return data?.data?.modified ?? 0;
}

export async function markAllNotificationsRead() {
  const { data } = await client.post('/notifications/read-all');
  return data?.data?.modified ?? 0;
}
