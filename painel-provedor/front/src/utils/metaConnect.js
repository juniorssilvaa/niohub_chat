/**
 * Host central onde corre o JS SDK da Meta (ex.: https://connect.niohub.com.br).
 * Definido em build-time: VITE_META_CONNECT_ORIGIN. Vazio = fluxo legacy no próprio subdomínio do provedor.
 */
export function getMetaConnectOrigin() {
  const raw = (import.meta.env.VITE_META_CONNECT_ORIGIN || '').trim().replace(/\/+$/, '');
  return raw || null;
}

/** true = fluxo Meta em iframe connect… (evita popup-in-popup bloqueado pelo browser) */
export function shouldUseMetaConnectIframe() {
  const connect = getMetaConnectOrigin();
  if (!connect || typeof window === 'undefined') return false;
  return window.location.origin !== connect;
}

/** Valida origem do tenant passada na query (iframe). */
export function isAllowedTenantOriginForMeta(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return u.protocol === 'http:' || u.protocol === 'https:';
    }
    if (u.protocol !== 'https:') return false;
    if (!host.endsWith('.niohub.com.br') && host !== 'niohub.com.br') return false;
    const connectHost = getMetaConnectOrigin();
    if (connectHost) {
      const ch = new URL(connectHost).hostname;
      if (host === ch) return false;
    }
    return true;
  } catch {
    return false;
  }
}
