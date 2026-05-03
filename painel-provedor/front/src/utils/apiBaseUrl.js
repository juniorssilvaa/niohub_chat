const FRONT_HOST = 'chat.niohub.com.br';
const FRONT_LOCAL_HOST = 'chat-local.niohub.com.br';
const APP_HOST = 'chat.niohub.com.br';

function stripTrailingSlash(value = '') {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  // PRIORIDADE 1: Multi-tenant detection (Produção niohub.com.br)
  if (hostname.endsWith('niohub.com.br')) {
    // Se for subdomínio da API, usa URL relativa
    if (hostname.startsWith('api')) {
      return '';
    }
    // Se for staging local
    if (hostname.startsWith('chat-local')) {
      return 'https://api-local.niohub.com.br';
    }
    // Para qualquer outro subdomínio (e-tech, chat, etc)
    // O Traefik roteia /api/ para o backend correto
    return '';
  }

  // PRIORIDADE 2: Variável de ambiente (Especialmente para builds customizados ou outros domínios)
  const envApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
  if (envApiUrl) {
    let cleaned = stripTrailingSlash(envApiUrl);
    if (cleaned.endsWith('/api')) {
      cleaned = cleaned.slice(0, -4);
    }
    return cleaned;
  }
  
  // PRIORIDADE 3: Modo de desenvolvimento (localhost)
  if (import.meta.env.DEV) {
    return ''; // Usa proxy do Vite
  }

  return '';
}

export function buildApiPath(path) {
  const normalizedPath = path?.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

