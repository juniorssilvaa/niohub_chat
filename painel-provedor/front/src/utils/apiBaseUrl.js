const FRONT_HOST = 'chat.niohub.com.br';
const FRONT_LOCAL_HOST = 'chat-local.niohub.com.br';
const APP_HOST = 'chat.niohub.com.br';

function stripTrailingSlash(value = '') {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const hostname = window.location.hostname;

  // PRIORIDADE 1: Multi-tenant detection
  // Se estiver em um subdomínio (e-tech, chat, etc), SEMPRE usar URL relativa
  if (hostname.endsWith('niohub.com.br') && !hostname.startsWith('api')) {
    if (hostname.startsWith('chat-local')) {
      return 'https://api-local.niohub.com.br';
    }
    return ''; // URL relativa para todos os provedores
  }

  // PRIORIDADE 2: Variável de ambiente (apenas para outros domínios ou localhost)
  const envApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
  if (envApiUrl) {
    let cleaned = stripTrailingSlash(envApiUrl);
    if (cleaned.endsWith('/api')) {
      cleaned = cleaned.slice(0, -4);
    }
    return cleaned;
  }
  
  // PRIORIDADE 2: Modo de desenvolvimento - SEMPRE usar proxy (vazio) ou localhost
  if (import.meta.env.DEV) {
    // Se VITE_USE_LOCAL_BACKEND estiver definido, sempre usar URL relativa (proxy)
    const forceLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === 'true';
    if (forceLocalBackend) {
      return '';
    }
    // Em desenvolvimento, usar proxy do Vite (URL relativa)
    return '';
  }

  // PRIORIDADE 3: Detecção por hostname (apenas em produção/staging)
  const hostname = window.location.hostname;
  
  // Em produção (chat.niohub.com.br ou qualquer subdomínio que não seja api/front)
  if (hostname.endsWith('niohub.com.br')) {
    if (hostname.startsWith('api')) {
      return ''; // Já está na API
    }
    if (hostname.startsWith('chat-local')) {
      return 'https://api-local.niohub.com.br';
    }
    // Para qualquer subdomínio (chat, e-tech, provedor-x, etc.)
    // O Traefik roteia /api/ para o backend correto do provedor
    return '';
  }

  // FALLBACK SEGURO: Em desenvolvimento, usar proxy (nunca produção)
  return '';
}

export function buildApiPath(path) {
  const normalizedPath = path?.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

