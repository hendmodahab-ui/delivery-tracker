export function apiUrl(path) {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  if (!baseUrl || /^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * authFetch - A drop-in replacement for fetch() that automatically
 * attaches the JWT token from localStorage to every request.
 */
export default function authFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Auto-set Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(apiUrl(url), {
    ...options,
    headers,
  });
}
