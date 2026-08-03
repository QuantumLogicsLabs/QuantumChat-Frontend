import axios from 'axios';
import { getToken } from '../crypto/keyStorage.js';
import { getApiUrl } from './baseUrl.js';

const client = axios.create({
  baseURL: getApiUrl(),
});

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function updatePrivacySettings(payload) {
  const { data } = await client.patch('/users/me/privacy', payload);
  return data;
}
export async function getNotificationSettings() {
  const { data } = await client.get('/users/me/notification-settings');
  return data;
}

export async function updateNotificationSettings(payload) {
  const { data } = await client.put('/users/me/notification-settings', payload);
  return data;
}
export async function muteChat(payload) {
  const { data } = await client.post('/users/me/mute', payload);
  return data;
}

export async function unmuteChat(payload) {
  const { data } = await client.post('/users/me/unmute', payload);
  return data;
}
export default client;
