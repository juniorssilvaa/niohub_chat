import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import useMetaEmbeddedSignupListener from '../hooks/useMetaEmbeddedSignupListener.js';
import { isAllowedTenantOriginForMeta } from '../utils/metaConnect';
import { META_APP_ID, META_CONFIG_ID } from '../config/metaWhatsApp';

const MSG = {
  READY: 'META_CONNECT_INNER_READY',
  AUTH: 'META_CONNECT_AUTH',
  SUCCESS: 'META_CONNECT_SUCCESS',
  ERROR: 'META_CONNECT_ERROR',
};

function tenantBridge() {
  return window.opener || window.parent;
}

/**
 * Pública em https://connect.../app/meta/connect-inner (popup ou iframe).
 */
export default function MetaConnectInner() {
  const [searchParams] = useSearchParams();
  const tenantOrigin = (searchParams.get('tenant_origin') || '').trim().replace(/\/+$/, '');
  const providerId = searchParams.get('provider_id') || '1';
  const channelId = searchParams.get('channel_id');
  const tenantOk = Boolean(tenantOrigin && isAllowedTenantOriginForMeta(tenantOrigin));

  const [step, setStep] = useState('auth_wait');
  const [error, setError] = useState(null);
  const [resultData, setResultData] = useState(null);
  const authCodeRef = useRef(null);
  const eventDataRef = useRef(null);
  const tokenRef = useRef(null);
  const hasLaunched = useRef(false);
  const sdkLoaded = useRef(false);
  const processingRef = useRef(false);

  function handleOnFinish(wabaId, eventData) {
    eventDataRef.current = { wabaId, ...eventData };
    tryFinalize();
  }

  const { sendFinishToBackend } = useMetaEmbeddedSignupListener({
    providerId,
    debug: true,
    onFinish: tenantOk ? handleOnFinish : undefined,
    apiOrigin: tenantOk ? tenantOrigin : null,
  });

  async function tryFinalize() {
    const token = tokenRef.current;
    if (!token) {
      setError('Token não recebido do painel.');
      setStep('error');
      return;
    }
    if (!eventDataRef.current || !authCodeRef.current) return;
    if (processingRef.current || step === 'success') return;

    const { wabaId, ...eventData } = eventDataRef.current;
    const code = authCodeRef.current;
    processingRef.current = true;
    setStep('processing');

    try {
      const fullPayloadData = { ...eventData, code };
      const response = await sendFinishToBackend(wabaId, providerId, {
        payload: fullPayloadData,
        channelId,
      });
      if (response.success) {
        setResultData(response.canal);
        setStep('success');
        const br = tenantBridge();
        if (br && tenantOk) {
          br.postMessage({ type: MSG.SUCCESS, canal: response.canal }, tenantOrigin);
        }
      } else {
        throw new Error(response.error || 'Erro ao processar integração');
      }
    } catch (err) {
      const msg = err.message || 'Erro';
      setError(msg);
      setStep('error');
      processingRef.current = false;
      const brErr = tenantBridge();
      if (brErr && tenantOk) {
        brErr.postMessage({ type: MSG.ERROR, message: msg }, tenantOrigin);
      }
    }
  }

  function launchWhatsAppSignup() {
    if (hasLaunched.current || !tokenRef.current || !tenantOk) return;
    hasLaunched.current = true;

    const BACKEND_URL = tenantOrigin.replace(/\/+$/, '');
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
      window.open(
        oauthUrl,
        'MetaSignup',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=yes`
      );
    }
  }

  useEffect(() => {
    if (!tenantOk) {
      setError('Origem do tenant inválida.');
      setStep('error');
      return;
    }

    const onMsg = (event) => {
      if (event.origin !== tenantOrigin) return;
      if (event.data?.type === MSG.AUTH && event.data.token) {
        tokenRef.current = event.data.token;
        setStep('waiting');
      }
    };
    window.addEventListener('message', onMsg);

    const br = tenantBridge();
    if (br) {
      setTimeout(() => {
        br.postMessage({ type: MSG.READY }, tenantOrigin);
      }, 0);
    }

    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl && !authCodeRef.current) {
      authCodeRef.current = codeFromUrl;
      tryFinalize();
    }

    const handleOAuthPopup = (event) => {
      if (event.data?.type === 'META_OAUTH_CALLBACK_COMPLETE' && event.data.code) {
        authCodeRef.current = event.data.code;
        tryFinalize();
      }
    };
    window.addEventListener('message', handleOAuthPopup);

    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('message', handleOAuthPopup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tryFinalize estável por closure do mount
  }, [searchParams, tenantOrigin, tenantOk]);

  useEffect(() => {
    if (!tenantOk || step !== 'waiting' || !tokenRef.current || sdkLoaded.current || hasLaunched.current)
      return;

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
  }, [step, tenantOk]);

  if (!tenantOk) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#b91c1c' }}>
        {error || 'tenant_origin inválido.'}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--background, #0f172a)',
        color: 'var(--foreground, #f8fafc)',
        fontFamily: 'sans-serif',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        {step === 'auth_wait' && (
          <>
            <Loader2 size={40} className="animate-spin" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14, opacity: 0.85 }}>A aguardar o painel…</p>
          </>
        )}
        {step === 'waiting' && (
          <>
            <Loader2 size={40} className="animate-spin" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14 }}>Conclua os passos na janela da Meta.</p>
          </>
        )}
        {step === 'processing' && (
          <>
            <Loader2 size={40} className="animate-spin" style={{ marginBottom: 12 }} />
            <p>A configurar o canal…</p>
          </>
        )}
        {step === 'success' && (
          <>
            <CheckCircle2 size={48} style={{ color: '#22c55e', marginBottom: 12 }} />
            <p>Concluído.</p>
            {resultData?.phone_number && (
              <p style={{ fontSize: 13, opacity: 0.8 }}>Número: {resultData.phone_number}</p>
            )}
          </>
        )}
        {step === 'error' && (
          <>
            <AlertCircle size={48} style={{ color: '#ef4444', marginBottom: 12 }} />
            <p>{error}</p>
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
