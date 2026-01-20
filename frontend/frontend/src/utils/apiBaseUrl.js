const FRONT_HOST = 'front.niochat.com.br';
const FRONT_LOCAL_HOST = 'front-local.niochat.com.br';
const APP_HOST = 'app.niochat.com.br';

function stripTrailingSlash(value = '') {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  // PRIORIDADE 1: Variável de ambiente VITE_API_URL (padrão) ou VITE_API_BASE_URL (legado)
  const envApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
  if (envApiUrl) {
    // Remover trailing slash E também remover /api se estiver no final
    // Isso evita duplicação quando as rotas já começam com /api/
    let cleaned = stripTrailingSlash(envApiUrl);
    if (cleaned.endsWith('/api')) {
      cleaned = cleaned.slice(0, -4); // Remove '/api' do final
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
  
  // Em produção (app.niochat.com.br ou qualquer subdomínio que não seja api/front)
  if (hostname.endsWith('niochat.com.br')) {
    if (hostname.startsWith('api')) {
      return ''; // Já está na API
    }
    if (hostname.startsWith('front-local')) {
      return 'https://api-local.niochat.com.br';
    }
    if (hostname.startsWith('front')) {
      return ''; // Usar proxy em front.niochat.com.br
    }
    // Para app.niochat.com.br ou qualquer outro (ex: cliente.niochat.com.br)
    return 'https://api.niochat.com.br';
  }

  // FALLBACK SEGURO: Em desenvolvimento, usar proxy (nunca produção)
  return '';
}

export function buildApiPath(path) {
  const normalizedPath = path?.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

