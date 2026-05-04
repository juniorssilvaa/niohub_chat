import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import useMetaEmbeddedSignupListener from '../hooks/useMetaEmbeddedSignupListener.js';
import { getBackendAbsoluteBase } from '../utils/apiBaseUrl';
import { getMetaConnectOrigin, shouldUseMetaConnectIframe } from '../utils/metaConnect';
import { META_APP_ID, META_CONFIG_ID } from '../config/metaWhatsApp';

const META_CONNECT_MSG = {
  READY: 'META_CONNECT_INNER_READY',
  AUTH: 'META_CONNECT_AUTH',
  SUCCESS: 'META_CONNECT_SUCCESS',
  ERROR: 'META_CONNECT_ERROR',
};

/** Painel no domínio do tenant: iframe aponta para connect.niohub.com.br (SDK Meta). */
function MetaFinalizingWithIframe() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const providerId = searchParams.get('provider_id') || '1';
  const channelId = searchParams.get('channel_id') || '';

  const [step, setStep] = useState('waiting');
  const [error, setError] = useState(null);
  const [resultData, setResultData] = useState(null);

  const connectOrigin = getMetaConnectOrigin();

  const iframeSrc = React.useMemo(() => {
    if (!connectOrigin) return '';
    const u = new URL('/app/meta/connect-inner', connectOrigin);
    u.searchParams.set('tenant_origin', window.location.origin);
    u.searchParams.set('provider_id', providerId);
    if (channelId) u.searchParams.set('channel_id', channelId);
    return u.toString();
  }, [channelId, connectOrigin, providerId]);

  useEffect(() => {
    if (!connectOrigin) return undefined;

    const onMsg = (e) => {
      if (e.origin !== connectOrigin) return;
      if (e.data?.type === META_CONNECT_MSG.READY) {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        const w = iframeRef.current?.contentWindow;
        if (w && token) {
          w.postMessage({ type: META_CONNECT_MSG.AUTH, token }, connectOrigin);
        }
      }
      if (e.data?.type === META_CONNECT_MSG.SUCCESS) {
        setResultData(e.data.canal);
        setStep('success');
      }
      if (e.data?.type === META_CONNECT_MSG.ERROR) {
        setError(e.data.message || 'Erro no fluxo Meta');
        setStep('error');
      }
    };

    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [connectOrigin]);

  if (!connectOrigin || !iframeSrc) {
    return (
      <div style={{ padding: 24 }}>
        <AlertCircle className="inline" /> VITE_META_CONNECT_ORIGIN não configurado.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        fontFamily: 'sans-serif',
        padding: '20px',
      }}
    >
      {step === 'waiting' && (
        <p style={{ marginBottom: 12, color: 'var(--muted-foreground)' }}>A abrir fluxo seguro da Meta…</p>
      )}
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          height: 'min(80vh, 640px)',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
          display: step === 'waiting' ? 'block' : 'none',
        }}
      >
        <iframe
          ref={iframeRef}
          title="Meta WhatsApp"
          src={iframeSrc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', minHeight: 400 }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        />
      </div>

      {step === 'success' && (
        <div style={{ marginTop: 24, maxWidth: 560, width: '100%', textAlign: 'center' }}>
          <CheckCircle2 size={64} style={{ color: '#22c55e', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#22c55e', marginBottom: 8 }}>Tudo pronto</h2>
          <p style={{ color: 'var(--muted-foreground)', marginBottom: 20 }}>
            WhatsApp Oficial ligado.
            {resultData?.phone_number && ` Número: ${resultData.phone_number}`}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/app/accounts/${providerId}/integracoes`)}
            style={{
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              padding: '14px 24px',
              borderRadius: '6px',
              fontWeight: 'bold',
              width: '100%',
            }}
          >
            Voltar para Integrações
          </button>
        </div>
      )}

      {step === 'error' && (
        <div style={{ marginTop: 24, maxWidth: 560, width: '100%', textAlign: 'center' }}>
          <AlertCircle size={48} style={{ color: '#ef4444', marginBottom: 12 }} />
          <p style={{ color: '#f87171' }}>{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 12, backgroundColor: '#1877f2', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 6 }}
          >
            Recarregar
          </button>
        </div>
      )}
    </div>
  );
}

/** Fluxo legacy: SDK no mesmo host que o painel. */
function MetaFinalizingInline() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const providerId = searchParams.get('provider_id') || '1';
  const channelId = searchParams.get('channel_id');

  const [step, setStep] = useState('waiting');
  const [error, setError] = useState(null);
  const [resultData, setResultData] = useState(null);
  const authCodeRef = useRef(null);
  const eventDataRef = useRef(null);
  const hasLaunched = useRef(false);
  const sdkLoaded = useRef(false);
  const processingRef = useRef(false);

  const hasToken = localStorage.getItem('auth_token') || localStorage.getItem('token');

  const { sendFinishToBackend } = useMetaEmbeddedSignupListener({
    providerId,
    debug: true,
    onFinish: hasToken ? handleOnFinish : undefined,
  });

  function handleOnFinish(wabaId, eventData) {
    eventDataRef.current = { wabaId, ...eventData };
    tryFinalize();
  }

  async function tryFinalize() {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) {
      setError('Token não encontrado. Faça login novamente.');
      setStep('error');
      return;
    }

    if (!eventDataRef.current || !authCodeRef.current) {
      return;
    }

    if (processingRef.current || step === 'success') return;

    const { wabaId, ...eventData } = eventDataRef.current;
    const code = authCodeRef.current;

    processingRef.current = true;
    setStep('processing');

    try {
      const fullPayloadData = { ...eventData, code };

      const response = await sendFinishToBackend(wabaId, providerId, { payload: fullPayloadData, channelId });

      if (response.success) {
        setResultData(response.canal);
        setStep('success');
      } else {
        throw new Error(response.error || 'Erro ao processar integração');
      }
    } catch (err) {
      setError(err.message);
      setStep('error');
      processingRef.current = false;
    }
  }

  function launchWhatsAppSignup() {
    if (hasLaunched.current) return;
    hasLaunched.current = true;
    const BACKEND_URL = getBackendAbsoluteBase();
    const redirectUri = encodeURIComponent(`${BACKEND_URL}/api/auth/facebook/callback/`);

    const extras = encodeURIComponent(
      JSON.stringify({
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3',
      })
    );
    const stateStr = `provider_${providerId}${window.location.protocol !== 'https:' ? '_local' : ''}`;
    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&config_id=${META_CONFIG_ID}&response_type=code&redirect_uri=${redirectUri}&state=${stateStr}&extras=${extras}`;

    if (window.location.protocol === 'https:' && window.FB) {
      window.FB.login(
        (response) => {
          if (response.authResponse?.code) {
            authCodeRef.current = response.authResponse.code;
            tryFinalize();
          }
        },
        {
          config_id: META_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        }
      );
    } else {
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(oauthUrl, 'MetaSignup', `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=yes`);
    }
  }

  useEffect(() => {
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl && !authCodeRef.current) {
      authCodeRef.current = codeFromUrl;
      tryFinalize();
    }

    const handleCallbackMessage = (event) => {
      if (event.data?.type === 'META_OAUTH_CALLBACK_COMPLETE' && event.data.code) {
        authCodeRef.current = event.data.code;
        tryFinalize();
      }
    };
    window.addEventListener('message', handleCallbackMessage);

    const initAndLaunch = () => {
      if (sdkLoaded.current || hasLaunched.current) return;

      if (window.location.protocol !== 'https:' && window.location.hostname === 'localhost') {
        launchWhatsAppSignup();
        return;
      }

      window.fbAsyncInit = function () {
        window.FB.init({
          appId: META_APP_ID,
          cookie: true,
          xfbml: true,
          version: 'v21.0',
        });
        sdkLoaded.current = true;
        launchWhatsAppSignup();
      };

      (function (d, s, id) {
        const fjs = d.getElementsByTagName(s)[0];
        if (d.getElementById(id)) return;
        const js = d.createElement(s);
        js.id = id;
        js.src = 'https://connect.facebook.net/pt_BR/sdk.js';
        fjs.parentNode.insertBefore(js, fjs);
      })(document, 'script', 'facebook-jssdk');
    };

    const timer = setTimeout(initAndLaunch, 500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', handleCallbackMessage);
    };
  }, [searchParams]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        fontFamily: 'sans-serif',
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--card)',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
          maxWidth: '550px',
          width: '100%',
          textAlign: 'center',
          border: '1px solid var(--border)',
        }}
      >
        {step === 'waiting' && (
          <>
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={60} className="animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Aguardando finalização...</h2>
            <p style={{ color: 'var(--muted-foreground)', lineHeight: '1.6', marginBottom: '24px' }}>
              Por favor, conclua os passos na janela da Meta que foi aberta. Esta página atualizará automaticamente ao
              terminar.
            </p>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--muted-foreground)',
                borderTop: '1px solid var(--border)',
                paddingTop: '16px',
              }}
            >
              Janela não abriu?{' '}
              <button
                type="button"
                onClick={() => {
                  hasLaunched.current = false;
                  launchWhatsAppSignup();
                }}
                style={{
                  color: 'var(--primary)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Clique aqui para tentar novamente
              </button>
            </div>
          </>
        )}

        {step === 'processing' && (
          <>
            <Loader2 size={60} className="animate-spin" style={{ color: 'var(--nc-accent, #fbbf24)', margin: '0 auto 20px' }} />
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Configurando Canal...</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>Recebemos os dados da Meta e estamos vinculando sua conta.</p>
          </>
        )}

        {step === 'success' && (
          <>
            <CheckCircle2 size={64} style={{ color: '#22c55e', margin: '0 auto 20px' }} />
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', color: '#22c55e' }}>Tudo Pronto!</h2>
            <p style={{ color: 'var(--muted-foreground)', marginBottom: '24px' }}>Seu WhatsApp Oficial foi conectado com sucesso.</p>

            <div
              style={{
                textAlign: 'left',
                backgroundColor: 'var(--background)',
                padding: '24px',
                borderRadius: '8px',
                fontSize: '15px',
                marginBottom: '32px',
                border: '1px solid var(--border)',
              }}
            >
              <div>
                <strong style={{ color: 'var(--muted-foreground)', width: '140px', display: 'inline-block' }}>Número:</strong>{' '}
                <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{resultData?.phone_number}</span>
              </div>
              <div>
                <strong style={{ color: 'var(--muted-foreground)', width: '140px', display: 'inline-block' }}>Status:</strong>{' '}
                <span style={{ color: 'var(--nc-success, #22c55e)' }}>{resultData?.status?.toUpperCase()}</span>
              </div>
              <div>
                <strong style={{ color: 'var(--muted-foreground)', width: '140px', display: 'inline-block' }}>WABA ID:</strong>{' '}
                {resultData?.waba_id}
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/app/accounts/${providerId}/integracoes`)}
              style={{
                backgroundColor: '#22c55e',
                color: 'white',
                border: 'none',
                padding: '14px 24px',
                borderRadius: '6px',
                fontWeight: 'bold',
                width: '100%',
              }}
            >
              Voltar para Integrações
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <AlertCircle size={60} style={{ color: '#ef4444', margin: '0 auto 20px' }} />
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px', color: '#ef4444' }}>Houve um problema</h2>
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                padding: '16px',
                borderRadius: '8px',
                color: '#f87171',
                marginBottom: '24px',
              }}
            >
              {error}
            </div>
            <button
              type="button"
              onClick={() => {
                hasLaunched.current = false;
                setStep('waiting');
                launchWhatsAppSignup();
              }}
              style={{ backgroundColor: '#1877f2', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '6px', width: '100%' }}
            >
              Tentar Novamente
            </button>
          </>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

export default function MetaFinalizing() {
  return shouldUseMetaConnectIframe() ? <MetaFinalizingWithIframe /> : <MetaFinalizingInline />;
}
