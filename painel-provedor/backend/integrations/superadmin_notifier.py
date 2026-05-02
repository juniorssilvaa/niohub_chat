"""
Superadmin Notifier Service - Painel do Provedor

Serviço responsável por notificar o Superadmin quando um canal WhatsApp
é conectado, para que o Dispatcher central saiba para onde encaminhar
os webhooks da Meta.
"""
import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def notify_superadmin_channel_connected(canal):
    """
    Notifica o Superadmin sobre um canal WhatsApp recém-conectado.
    Envia waba_id e phone_number_id para que o dispatcher
    saiba rotear os webhooks para este provedor.

    Executado de forma segura (nunca vai quebrar o fluxo principal).
    """
    try:
        # Configurações necessárias
        superadmin_url = getattr(settings, 'SUPERADMIN_API_URL', '').rstrip('/')
        admin_secret = getattr(settings, 'ADMIN_WEBHOOK_SECRET', '')
        provedor_id = getattr(settings, 'SUPERADMIN_PROVEDOR_ID', None)

        if not superadmin_url or not admin_secret or not provedor_id:
            logger.warning(
                "[SuperadminNotifier] SUPERADMIN_API_URL, ADMIN_WEBHOOK_SECRET ou "
                "SUPERADMIN_PROVEDOR_ID não configurados. Pulando notificação."
            )
            return

        if not canal.waba_id:
            logger.warning(
                f"[SuperadminNotifier] Canal {canal.id} não tem waba_id. Pulando notificação."
            )
            return

        payload = {
            "secret": admin_secret,
            "provedor_id": int(provedor_id),
            "waba_id": canal.waba_id,
            "phone_number_id": canal.phone_number_id or "",
            "phone_number": canal.phone_number or "",
            "canal_nome": canal.nome or "WhatsApp",
            "tipo": canal.tipo or "whatsapp_oficial",
        }

        url = f"{superadmin_url}/api/webhooks/provider/channel-register/"
        response = requests.post(url, json=payload, timeout=10, verify=True)

        if response.status_code == 200:
            logger.info(
                f"[SuperadminNotifier] Canal {canal.id} registrado no Superadmin com sucesso. "
                f"waba_id={canal.waba_id}"
            )
        else:
            logger.warning(
                f"[SuperadminNotifier] Falha ao registrar canal no Superadmin: "
                f"HTTP {response.status_code} - {response.text[:200]}"
            )
    except Exception as e:
        # NUNCA deve quebrar o fluxo principal
        logger.error(f"[SuperadminNotifier] Erro ao notificar Superadmin: {e}")
