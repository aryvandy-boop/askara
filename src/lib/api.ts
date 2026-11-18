const TOKEN_KEY = 'askara_session_token';

let memoryToken: string | null = typeof window !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
  if (typeof window !== 'undefined') {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    let message = `Permintaan gagal (${res.status})`;
    let extra: Record<string, any> = {};
    if (contentType.includes('application/json')) {
      const errData = await res.json().catch(() => ({}));
      message = errData.error || message;
      extra = errData;
    } else {
      const txt = await res.text().catch(() => '');
      if (/MulterError:\s*File too large|LIMIT_FILE_SIZE|413 Request Entity Too Large/i.test(txt) || res.status === 413) {
        message = 'Ukuran file terlalu besar. Perkecil ukuran file (maksimal 50 MB, disarankan < 30 MB) lalu coba unggah kembali.';
      } else if (txt) {
        const stripped = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (stripped) message = stripped.slice(0, 220);
      }
    }
    const errObj: any = new Error(message);
    Object.assign(errObj, extra);
    throw errObj;
  }

  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res as unknown as T;
}

export async function compressLogoIfNeeded(file: File, maxBytes = 1.5 * 1024 * 1024, maxDim = 900): Promise<File> {
  if (file.size <= maxBytes || !file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          return resolve(file);
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objUrl);
            if (!blob || blob.size >= file.size) return resolve(file);
            const cleanName = file.name.replace(/\.[^.]+$/, '') + '.png';
            resolve(new File([blob], cleanName, { type: 'image/png' }));
          },
          'image/png',
          0.92
        );
      } catch {
        URL.revokeObjectURL(objUrl);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      resolve(file);
    };
    img.src = objUrl;
  });
}

export async function downloadAuthorizedFile(url: string, fallbackFileName: string) {
  const headers = new Headers();
  if (memoryToken) headers.set('Authorization', `Bearer ${memoryToken}`);

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Gagal mengunduh dokumen.' }));
    throw new Error(err.error || 'Gagal mengunduh dokumen.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackFileName;

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
