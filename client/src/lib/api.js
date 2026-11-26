let csrfToken = null;
let onUnauthorized = () => {};

export const setCsrf = t => { csrfToken = t; };
export const setOnUnauthorized = fn => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || (status === 0 ? 'Cannot reach the server. Check your connection.' : `Request failed (${status})`));
    this.status = status;
    this.code = body?.code;
    this.fields = body?.fields || {};
    this.details = body?.details;
  }
}

const buildUrl = (path, query) => {
  const url = new URL('/api' + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return url;
};

/** JSON API call. Session cookie is sent automatically; CSRF token added for writes. */
export async function api(path, { method = 'GET', body, query } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}

/** Same-origin download link (cookie-authenticated GET). */
export const exportUrl = (path, query) => buildUrl(path, query).toString();
