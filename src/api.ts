import { createBrowserSample } from './browserSample';

const browserSample = import.meta.env.MODE === 'pages' ? createBrowserSample(__SAMPLE_CONFIG__) : null;

export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  if (import.meta.env.MODE === 'pages') return browserSample!<T>(url, method, body);
  const response = await fetch(`/api${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
