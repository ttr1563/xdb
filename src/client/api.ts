export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String(body.error)
      : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
