const TOKEN_STORAGE_KEY = 'waselha_auth_token';

function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
}

const RAW_ENV_API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || ''
);

function isLocalOrAiStudioDevHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.startsWith('ais-dev-')
  );
}

export function getEffectiveApiBase(): string {
  if (typeof window !== 'undefined') {
    const { protocol, hostname, origin } = window.location;
    // Local dev and AI Studio Dev proxy always serve /api on the same origin
    if ((protocol === 'http:' || protocol === 'https:') && isLocalOrAiStudioDevHost(hostname)) {
      return '';
    }
    // Use configured VITE_API_URL / VITE_API_BASE_URL when targeting an external backend
    if (RAW_ENV_API_BASE) {
      if (origin && normalizeApiBase(origin) === RAW_ENV_API_BASE) {
        return '';
      }
      return RAW_ENV_API_BASE;
    }
    if (protocol === 'http:' || protocol === 'https:') {
      return '';
    }
  }
  return RAW_ENV_API_BASE;
}

export function resolveApiUrl(path: string): string {
  const apiBase = getEffectiveApiBase();
  if (!path) return apiBase;
  if (/^https?:\/\//i.test(path)) return path;
  if (!apiBase) return path;
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveAssetUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  const apiBase = getEffectiveApiBase();
  if (path.startsWith('/uploads/') && apiBase) {
    return `${apiBase}${path}`;
  }
  return path;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(url), {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new Error('تعذر الاتصال بالخادم الخلفي. تأكد من أن السيرفر يعمل.');
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  let data: Record<string, unknown> = {};

  if (contentType.includes('application/json')) {
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = { error: 'تعذر قراءة استجابة الخادم.' };
    }
  } else {
    const rawText = (await response.text()).trim();
    const looksLikeHtml =
      rawText.startsWith('<!') ||
      rawText.startsWith('<html') ||
      contentType.includes('text/html');
    if (response.ok && looksLikeHtml) {
      throw new Error('مسار الـ API غير مربوط بالخادم الخلفي بشكل صحيح.');
    }
    data = {
      error: looksLikeHtml
        ? `تعذر الوصول إلى مسار الخادم (${response.status}).`
        : rawText.slice(0, 200),
    };
  }

  if (!response.ok) {
    const errMsg = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : '';
    throw new Error(errMsg || `حدث خطأ في الاتصال بالخادم (${response.status}).`);
  }

  return data as T;
}

export async function uploadImageFile(file: File): Promise<string> {
  if (file.size > 3 * 1024 * 1024) {
    throw new Error('حجم الصورة كبير جداً. الحد الأقصى المسموح به 3 ميجابايت.');
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.readAsDataURL(file);
  });

  const res = await apiRequest<{ url: string }>('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
  return res.url;
}
