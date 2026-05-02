"""
Webhook Dispatcher - Superadmin Central

Recebe TODOS os eventos da Meta (WhatsApp Cloud API) em uma única URL:
    POST https://api.niohub.com.br/api/webhook/whatsapp-cloud/

Identifica o provedor pelo waba_id ou phone_number_id e encaminha
o payload completo para o backend desse provedor de forma assíncrona.

Fluxo:
1. Meta POST → validar assinatura → retornar 200 imediatamente
2. Background thread → lookup provedor → forward POST para o provedor
"""
import json
import hmac
import hashlib
import logging
import threading
import requests

from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.conf import settings

from .models import Canal

logger = logging.getLogger(__name__)


def _verify_signature(body: bytes, signature: str) -> bool:
    """Valida X-Hub-Signature-256 da Meta."""
    if not signature or not signature.startswith("sha256="):
        return False
    app_secret = getattr(settings, 'FACEBOOK_APP_SECRET', '')
    if not app_secret:
        return False
    expected = hmac.new(
        app_secret.encode('utf-8'),
        body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature.replace("sha256=", ""), expected)


def _extract_identifiers(data: dict) -> list[dict]:
    """
    Extrai todos os pares (waba_id, phone_number_id) presentes no payload.
    Retorna lista para suportar múltiplos entries no mesmo POST.
    """
    identifiers = []
    for entry in data.get("entry", []):
        waba_id = entry.get("id")
        phone_ids = set()
        for change in entry.get("changes", []):
            value = change.get("value", {})
            pid = value.get("metadata", {}).get("phone_number_id")
            if pid:
                phone_ids.add(pid)
        identifiers.append({
            "waba_id": waba_id,
            "phone_number_ids": list(phone_ids)
        })
    return identifiers


def _find_provider_url(waba_id: str, phone_number_ids: list) -> str | None:
    """
    Busca o subdomain do provedor no banco do superadmin.
    Prioridade: phone_number_id > waba_id
    """
    canal = None

    # 1. Tentar pelo phone_number_id (mais específico)
    if phone_number_ids:
        canal = Canal.objects.filter(
            phone_number_id__in=phone_number_ids,
            tipo="whatsapp_oficial",
            ativo=True
        ).select_related('provedor').first()

    # 2. Fallback: tentar pelo waba_id
    if not canal and waba_id:
        canal = Canal.objects.filter(
            waba_id=waba_id,
            tipo="whatsapp_oficial",
            ativo=True
        ).select_related('provedor').first()

    if canal and canal.provedor and canal.provedor.subdomain:
        subdomain = canal.provedor.subdomain
        # Monta a URL do backend do provedor
        # Padrão: api.{subdomain}/api/webhook/whatsapp-cloud/
        return f"https://api.{subdomain}/api/webhook/whatsapp-cloud/"

    return None


def _forward_to_provider(provider_url: str, raw_body: bytes, headers: dict):
    """
    Encaminha o payload original para o provedor.
    Executado em background thread para não bloquear a resposta para a Meta.
    """
    try:
        forward_headers = {
            "Content-Type": "application/json",
        }
        # Repassa a assinatura original para que o provedor também possa validar
        if "X-Hub-Signature-256" in headers:
            forward_headers["X-Hub-Signature-256"] = headers["X-Hub-Signature-256"]
        if "X-Hub-Signature" in headers:
            forward_headers["X-Hub-Signature"] = headers["X-Hub-Signature"]

        resp = requests.post(
            provider_url,
            data=raw_body,
            headers=forward_headers,
            timeout=15,
            verify=True
        )
        logger.info(f"[Dispatcher] Forward para {provider_url} → HTTP {resp.status_code}")
    except requests.exceptions.Timeout:
        logger.warning(f"[Dispatcher] Timeout ao encaminhar para {provider_url}")
    except Exception as e:
        logger.error(f"[Dispatcher] Erro ao encaminhar para {provider_url}: {e}")


@csrf_exempt
@require_http_methods(["GET", "POST"])
def whatsapp_dispatcher(request):
    """
    Endpoint central de webhook da Meta.

    GET  → Verificação (challenge) do webhook
    POST → Receber eventos e encaminhar para o provedor correto
    """
    # ─── GET: Verificação do webhook ───────────────────────────────────────────
    if request.method == "GET":
        mode = request.GET.get("hub.mode")
        token = request.GET.get("hub.verify_token")
        challenge = request.GET.get("hub.challenge")

        if mode != "subscribe":
            return JsonResponse({"error": "Invalid mode"}, status=403)

        expected_token = getattr(settings, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')
        if not expected_token or token != expected_token:
            return JsonResponse({"error": "Verification failed"}, status=403)

        return HttpResponse(challenge, content_type='text/plain', status=200)

    # ─── POST: Receber eventos ──────────────────────────────────────────────────
    raw_body = request.body
    signature = (
        request.headers.get('X-Hub-Signature-256') or
        request.headers.get('X-Hub-Signature', '')
    )
    is_dev = getattr(settings, 'DEBUG', False)

    # Validar assinatura
    if signature:
        if not _verify_signature(raw_body, signature):
            if not is_dev:
                logger.warning("[Dispatcher] Assinatura inválida recebida.")
                return JsonResponse({"error": "Invalid signature"}, status=403)
    else:
        if not is_dev:
            logger.warning("[Dispatcher] POST sem assinatura rejeitado.")
            return JsonResponse({"error": "Missing signature"}, status=403)

    # ─── ACK imediato para a Meta ──────────────────────────────────────────────
    # A Meta exige resposta em poucos segundos. Respondemos aqui e
    # processamos o forward em background para não ter timeout.
    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    if data.get("object") != "whatsapp_business_account":
        return JsonResponse({"status": "ignored"}, status=200)

    # Extrair identificadores e encaminhar em background
    identifiers = _extract_identifiers(data)
    req_headers = dict(request.headers)

    def dispatch():
        forwarded = set()
        for ident in identifiers:
            url = _find_provider_url(
                ident["waba_id"],
                ident["phone_number_ids"]
            )
            if url and url not in forwarded:
                forwarded.add(url)
                _forward_to_provider(url, raw_body, req_headers)
            elif not url:
                logger.warning(
                    f"[Dispatcher] Provedor não encontrado para "
                    f"waba_id={ident['waba_id']} "
                    f"phone_ids={ident['phone_number_ids']}"
                )

    thread = threading.Thread(target=dispatch, daemon=True)
    thread.start()

    return JsonResponse({"status": "ok"}, status=200)


@csrf_exempt
def provider_channel_register(request):
    """
    Endpoint chamado pelo painel do provedor quando um canal WhatsApp
    é conectado. Salva o waba_id e phone_number_id no superadmin para
    que o dispatcher saiba para onde encaminhar os webhooks.

    POST /api/webhooks/provider/channel-register/
    Body:
    {
        "secret": "<ADMIN_WEBHOOK_SECRET>",
        "provedor_id": 7,
        "waba_id": "3052659568268187",
        "phone_number_id": "123456789",
        "phone_number": "+55 94 3198-1266",
        "canal_nome": "DISPARO",
        "tipo": "whatsapp_oficial"
    }
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    # Validar secret
    config_secret = None
    try:
        from .models import SystemConfig
        config = SystemConfig.objects.first()
        if config and config.payload:
            config_secret = config.payload.get('ADMIN_WEBHOOK_SECRET')
    except Exception:
        pass

    secret = data.get("secret", "")
    if not config_secret or secret != config_secret:
        logger.warning(f"[ChannelRegister] Secret inválido recebido.")
        return JsonResponse({"error": "Unauthorized"}, status=403)

    provedor_id = data.get("provedor_id")
    waba_id = data.get("waba_id", "").strip()
    phone_number_id = data.get("phone_number_id", "").strip()
    phone_number = data.get("phone_number", "").strip()
    canal_nome = data.get("canal_nome", "WhatsApp").strip()
    tipo = data.get("tipo", "whatsapp_oficial").strip()

    if not provedor_id or not waba_id:
        return JsonResponse({"error": "provedor_id e waba_id são obrigatórios"}, status=400)

    try:
        from .models import Provedor
        provedor = Provedor.objects.get(id=provedor_id)
    except Provedor.DoesNotExist:
        return JsonResponse({"error": "Provedor não encontrado"}, status=404)

    # Criar ou atualizar o canal no superadmin
    canal, created = Canal.objects.update_or_create(
        provedor=provedor,
        tipo=tipo,
        waba_id=waba_id,
        defaults={
            "nome": canal_nome,
            "phone_number": phone_number,
            "phone_number_id": phone_number_id,
            "ativo": True,
        }
    )

    action = "criado" if created else "atualizado"
    logger.info(
        f"[ChannelRegister] Canal {action}: {canal_nome} "
        f"(provedor={provedor.nome}, waba_id={waba_id})"
    )

    return JsonResponse({
        "status": "ok",
        "canal_id": canal.id,
        "action": action
    })
