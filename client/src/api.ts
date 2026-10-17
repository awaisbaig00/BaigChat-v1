let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;

  // Try reading from cookie 'baigchat_csrf'
  const match = document.cookie.match(new RegExp('(^| )baigchat_csrf=([^;]+)'));
  if (match) {
    return decodeURIComponent(match[2]);
  }
  return null;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Mutating requests require X-CSRF-Token
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const token = getCsrfToken();
    if (token) {
      headers.set('X-CSRF-Token', token);
    }
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // sends httpOnly session cookie
  });

  const contentType = response.headers.get('content-type');
  let data: any = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMessage = data?.error || (typeof data === 'string' ? data : 'Request failed');
    throw new Error(errorMessage);
  }

  // If response contains csrfToken, save it
  if (data && typeof data === 'object' && data.csrfToken) {
    setCsrfToken(data.csrfToken);
  }

  return data as T;
}
