import { fetch } from 'expo/fetch';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!apiBaseUrl) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured');
  }

  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}
