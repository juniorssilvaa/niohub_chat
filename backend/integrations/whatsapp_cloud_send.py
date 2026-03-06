"""
Função para enviar mensagens via WhatsApp Cloud API (Oficial)
"""
import requests
import logging
import json
import os
from typing import Tuple, Optional, List, Dict, Any
from core.models import Canal
from integrations.meta_oauth import PHONE_NUMBERS_API_VERSION
from django.conf import settings

logger = logging.getLogger(__name__)


def translate_whatsapp_error(error_code: int, error_subcode: Optional[int] = None, error_message: str = "") -> str:
    """
    Traduz códigos de erro da API do WhatsApp para português.
    Baseado em: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
    
    Args:
        error_code: Código de erro principal
        error_subcode: Subcódigo de erro (opcional)
        error_message: Mensagem de erro original (opcional)
    
    Returns:
        str: Mensagem de erro traduzida em português
    """
    # Erros comuns da API do WhatsApp
    error_translations = {
        # Erros de autenticação e permissão
        190: "Token de acesso expirado ou inválido. Por favor, reconecte o canal WhatsApp.",
        10: "Permissão negada. Verifique se o token tem as permissões necessárias.",
        200: "Permissão negada. O token não tem acesso a este recurso.",
        
        # Erros de rate limiting
        4: "Limite de requisições excedido. Aguarde alguns minutos antes de tentar novamente.",
        17: "Muitas requisições. Por favor, aguarde antes de tentar novamente.",
        32: "Limite de requisições excedido. Tente novamente mais tarde.",
        
        # Erros de mensagens
        131000: "Número de telefone inválido. Verifique se o número está correto e no formato internacional.",
        131001: "Número de telefone não está registrado no WhatsApp.",
        131002: "Número de telefone não está registrado no WhatsApp.",
        131003: "Número de telefone não está registrado no WhatsApp.",
        131004: "Número de telefone não está registrado no WhatsApp.",
        131005: "Número de telefone não está registrado no WhatsApp.",
        131006: "Número de telefone não está registrado no WhatsApp.",
        131007: "Número de telefone não está registrado no WhatsApp.",
        131008: "Número de telefone não está registrado no WhatsApp.",
        131009: "A janela de atendimento ao cliente está fechada. Use uma mensagem de template para iniciar uma nova conversa.",
        131010: "A mensagem não pode ser entregue porque o número de telefone não está registrado no WhatsApp.",
        131016: "Mensagem não pode ser entregue. O número pode estar bloqueado ou não estar mais no WhatsApp.",
        131021: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131026: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp ou não é válido.",
        131031: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131042: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131045: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131047: "Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.",
        131048: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131051: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131052: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131053: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131054: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131055: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131056: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131057: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131058: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131059: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131060: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131061: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131062: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131063: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131064: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131065: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131066: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131067: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131068: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131069: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131070: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131071: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131072: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131073: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131074: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131075: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131076: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131077: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131078: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131079: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131080: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131081: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131082: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131083: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131084: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131085: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131086: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131087: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131088: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131089: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131090: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131091: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131092: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131093: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131094: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131095: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131096: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131097: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131098: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131099: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        131100: "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp.",
        
        # Erros de template
        132000: "Template de mensagem não encontrado ou não aprovado.",
        132001: "Template de mensagem não encontrado ou não aprovado.",
        132002: "Template de mensagem não encontrado ou não aprovado.",
        132003: "Template de mensagem não encontrado ou não aprovado.",
        132004: "Template de mensagem não encontrado ou não aprovado.",
        132005: "Template de mensagem não encontrado ou não aprovado.",
        132006: "Template de mensagem não encontrado ou não aprovado.",
        132007: "Template de mensagem não encontrado ou não aprovado.",
        132008: "Template de mensagem não encontrado ou não aprovado.",
        132009: "Template de mensagem não encontrado ou não aprovado.",
        132010: "Template de mensagem não encontrado ou não aprovado.",
        132011: "Template de mensagem não encontrado ou não aprovado.",
        132012: "Template de mensagem não encontrado ou não aprovado.",
        132013: "Template de mensagem não encontrado ou não aprovado.",
        132014: "Template de mensagem não encontrado ou não aprovado.",
        132015: "Template de mensagem não encontrado ou não aprovado.",
        132016: "Template de mensagem não encontrado ou não aprovado.",
        132017: "Template de mensagem não encontrado ou não aprovado.",
        132018: "Template de mensagem não encontrado ou não aprovado.",
        132019: "Template de mensagem não encontrado ou não aprovado.",
        132020: "Template de mensagem não encontrado ou não aprovado.",
        132021: "Template de mensagem não encontrado ou não aprovado.",
        132022: "Template de mensagem não encontrado ou não aprovado.",
        132023: "Template de mensagem não encontrado ou não aprovado.",
        132024: "Template de mensagem não encontrado ou não aprovado.",
        132025: "Template de mensagem não encontrado ou não aprovado.",
        132026: "Template de mensagem não encontrado ou não aprovado.",
        132027: "Template de mensagem não encontrado ou não aprovado.",
        132028: "Template de mensagem não encontrado ou não aprovado.",
        132029: "Template de mensagem não encontrado ou não aprovado.",
        132030: "Template de mensagem não encontrado ou não aprovado.",
        132031: "Template de mensagem não encontrado ou não aprovado.",
        132032: "Template de mensagem não encontrado ou não aprovado.",
        132033: "Template de mensagem não encontrado ou não aprovado.",
        132034: "Template de mensagem não encontrado ou não aprovado.",
        132035: "Template de mensagem não encontrado ou não aprovado.",
        132036: "Template de mensagem não encontrado ou não aprovado.",
        132037: "Template de mensagem não encontrado ou não aprovado.",
        132038: "Template de mensagem não encontrado ou não aprovado.",
        132039: "Template de mensagem não encontrado ou não aprovado.",
        132040: "Template de mensagem não encontrado ou não aprovado.",
        132041: "Template de mensagem não encontrado ou não aprovado.",
        132042: "Template de mensagem não encontrado ou não aprovado.",
        132043: "Template de mensagem não encontrado ou não aprovado.",
        132044: "Template de mensagem não encontrado ou não aprovado.",
        132045: "Template de mensagem não encontrado ou não aprovado.",
        132046: "Template de mensagem não encontrado ou não aprovado.",
        132047: "Template de mensagem não encontrado ou não aprovado.",
        132048: "Template de mensagem não encontrado ou não aprovado.",
        132049: "Template de mensagem não encontrado ou não aprovado.",
        132050: "Template de mensagem não encontrado ou não aprovado.",
        132051: "Template de mensagem não encontrado ou não aprovado.",
        132052: "Template de mensagem não encontrado ou não aprovado.",
        132053: "Template de mensagem não encontrado ou não aprovado.",
        132054: "Template de mensagem não encontrado ou não aprovado.",
        132055: "Template de mensagem não encontrado ou não aprovado.",
        132056: "Template de mensagem não encontrado ou não aprovado.",
        132057: "Template de mensagem não encontrado ou não aprovado.",
        132058: "Template de mensagem não encontrado ou não aprovado.",
        132059: "Template de mensagem não encontrado ou não aprovado.",
        132060: "Template de mensagem não encontrado ou não aprovado.",
        132061: "Template de mensagem não encontrado ou não aprovado.",
        132062: "Template de mensagem não encontrado ou não aprovado.",
        132063: "Template de mensagem não encontrado ou não aprovado.",
        132064: "Template de mensagem não encontrado ou não aprovado.",
        132065: "Template de mensagem não encontrado ou não aprovado.",
        132066: "Template de mensagem não encontrado ou não aprovado.",
        132067: "Template de mensagem não encontrado ou não aprovado.",
        132068: "Template de mensagem não encontrado ou não aprovado.",
        132069: "Template de mensagem não encontrado ou não aprovado.",
        132070: "Template de mensagem não encontrado ou não aprovado.",
        132071: "Template de mensagem não encontrado ou não aprovado.",
        132072: "Template de mensagem não encontrado ou não aprovado.",
        132073: "Template de mensagem não encontrado ou não aprovado.",
        132074: "Template de mensagem não encontrado ou não aprovado.",
        132075: "Template de mensagem não encontrado ou não aprovado.",
        132076: "Template de mensagem não encontrado ou não aprovado.",
        132077: "Template de mensagem não encontrado ou não aprovado.",
        132078: "Template de mensagem não encontrado ou não aprovado.",
        132079: "Template de mensagem não encontrado ou não aprovado.",
        132080: "Template de mensagem não encontrado ou não aprovado.",
        132081: "Template de mensagem não encontrado ou não aprovado.",
        132082: "Template de mensagem não encontrado ou não aprovado.",
        132083: "Template de mensagem não encontrado ou não aprovado.",
        132084: "Template de mensagem não encontrado ou não aprovado.",
        132085: "Template de mensagem não encontrado ou não aprovado.",
        132086: "Template de mensagem não encontrado ou não aprovado.",
        132087: "Template de mensagem não encontrado ou não aprovado.",
        132088: "Template de mensagem não encontrado ou não aprovado.",
        132089: "Template de mensagem não encontrado ou não aprovado.",
        132090: "Template de mensagem não encontrado ou não aprovado.",
        132091: "Template de mensagem não encontrado ou não aprovado.",
        132092: "Template de mensagem não encontrado ou não aprovado.",
        132093: "Template de mensagem não encontrado ou não aprovado.",
        132094: "Template de mensagem não encontrado ou não aprovado.",
        132095: "Template de mensagem não encontrado ou não aprovado.",
        132096: "Template de mensagem não encontrado ou não aprovado.",
        132097: "Template de mensagem não encontrado ou não aprovado.",
        132098: "Template de mensagem não encontrado ou não aprovado.",
        132099: "Template de mensagem não encontrado ou não aprovado.",
        132100: "Template de mensagem não encontrado ou não aprovado.",
        
        # Erros de mídia
        133000: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133001: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133002: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133003: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133004: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133005: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133006: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133007: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133008: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133009: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133010: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133011: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133012: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133013: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133014: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133015: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133016: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133017: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133018: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133019: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133020: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133021: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133022: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133023: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133024: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133025: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133026: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133027: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133028: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133029: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133030: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133031: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133032: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133033: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133034: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133035: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133036: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133037: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133038: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133039: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133040: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133041: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133042: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133043: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133044: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133045: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133046: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133047: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133048: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133049: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133050: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133051: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133052: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133053: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133054: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133055: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133056: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133057: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133058: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133059: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133060: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133061: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133062: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133063: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133064: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133065: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133066: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133067: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133068: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133069: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133070: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133071: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133072: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133073: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133074: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133075: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133076: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133077: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133078: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133079: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133080: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133081: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133082: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133083: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133084: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133085: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133086: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133087: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133088: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133089: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133090: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133091: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133092: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133093: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133094: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133095: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133096: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133097: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133098: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133099: "Erro ao processar mídia. Verifique se o arquivo é válido.",
        133100: "Erro ao processar mídia. Verifique se o arquivo é válido.",
    }
    
    # Verificar se há tradução específica para o código
    if error_code in error_translations:
        return error_translations[error_code]
    
    # Verificar se há tradução para o subcódigo
    if error_subcode and error_subcode in error_translations:
        return error_translations[error_subcode]
    
    # Para códigos de erro genéricos por faixa
    if 131000 <= error_code <= 131999:
        if error_code == 131009:
            return "A janela de atendimento ao cliente está fechada. Use uma mensagem de template para iniciar uma nova conversa."
        return "Mensagem não pode ser entregue. O número de telefone não está registrado no WhatsApp ou não é válido."
    elif 132000 <= error_code <= 132999:
        return "Template de mensagem não encontrado ou não aprovado."
    elif 133000 <= error_code <= 133999:
        return "Erro ao processar mídia. Verifique se o arquivo é válido."
    
    # Se não houver tradução específica, retornar mensagem genérica com o código
    if error_message:
        return f"{error_message} (Código: {error_code})"
    
    return f"Erro ao processar requisição. Código de erro: {error_code}"


def upload_media_to_whatsapp(canal: Canal, file_path: str, media_type: str, mime_type: str) -> Tuple[bool, Optional[str]]:
    """
    Faz upload de mídia para a API do WhatsApp e retorna o media_id.
    
    Args:
        canal: Objeto Canal com token configurado
        file_path: Caminho local do arquivo
        media_type: Tipo de mídia (image, video, audio, document)
        mime_type: Tipo MIME do arquivo (ex: image/jpeg, video/mp4)
    
    Returns:
        tuple: (success: bool, media_id: Optional[str])
    """
    try:
        if not os.path.exists(file_path):
            return False, f"Arquivo não encontrado: {file_path}"
        
        # Endpoint para upload de mídia
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/media"
        
        # Ler o arquivo
        with open(file_path, 'rb') as file:
            files = {
                'file': (os.path.basename(file_path), file, mime_type),
            }
            
            data = {
                'messaging_product': 'whatsapp',
                'type': media_type  # Tipo básico: image, video, audio, document
            }
            
            headers = {
                "Authorization": f"Bearer {canal.token}"
            }
            
            response = requests.post(url, files=files, data=data, headers=headers, timeout=60)
            
            if response.status_code == 200:
                response_data = response.json()
                media_id = response_data.get('id')
                if media_id:
                    logger.info(f"Mídia enviada com sucesso. Media ID: {media_id}")
                    return True, media_id
                else:
                    return False, "Media ID não retornado na resposta"
            else:
                error_msg = response.text
                logger.error(f"Erro ao fazer upload de mídia: {response.status_code} - {error_msg}")
                return False, error_msg
    
    except Exception as e:
        logger.error(f"Exceção ao fazer upload de mídia: {str(e)}")
        return False, str(e)


def send_via_whatsapp_cloud_api(
    conversation,
    content: str,
    message_type: str = 'text',
    file_url: Optional[str] = None,
    file_path: Optional[str] = None,
    file_name: Optional[str] = None,
    mime_type: Optional[str] = None,
    is_voice_message: Optional[bool] = None,
    reply_to_message_id: Optional[str] = None,
    buttons: Optional[List[Dict]] = None,
    order_details: Optional[Dict] = None,
    **kwargs
) -> Tuple[bool, Optional[str]]:
    """
    Envia mensagem via WhatsApp Cloud API (Oficial).
    
    Args:
        conversation: Objeto Conversation
        content: Conteúdo da mensagem
        message_type: Tipo da mensagem ('text', 'image', 'audio', 'video', 'document')
        file_url: URL do arquivo (para tipos de mídia)
        reply_to_message_id: ID da mensagem a responder (opcional)
    
    Returns:
        tuple: (success: bool, response: str ou dict)
    """
    try:
        provedor = conversation.inbox.provedor
        
        # Buscar canal WhatsApp Oficial do provedor
        canal = Canal.objects.filter(
            provedor=provedor,
            tipo="whatsapp_oficial",
            ativo=True
        ).first()
        
        if not canal:
            return False, "Canal WhatsApp Oficial não encontrado"
        
        if not canal.token:
            return False, "Token do canal não configurado"
        
        if not canal.phone_number_id:
            return False, "Phone Number ID não configurado"
        
        # Obter número do destinatário do contato
        contact = conversation.contact
        recipient_number = conversation.contact.phone.replace('@s.whatsapp.net', '').replace('@c.us', '')
        
        # Garantir formato com '+' para Meta Cloud API (conforme testes manuais do usuário)
        if not recipient_number.startswith('+'):
            if not recipient_number.startswith('55') and len(recipient_number) <= 11:
                recipient_number = '55' + recipient_number
            recipient_number = '+' + recipient_number
        
        payload: Dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_number
        }
        
        # Adicionar reply_to se fornecido
        if reply_to_message_id:
            payload["context"] = {
                "message_id": reply_to_message_id
            }
        
        # Montar payload específico por tipo
        if message_type == 'text':
            payload["type"] = "text"
            payload["text"] = {
                "preview_url": False,
                "body": content
            }
        elif message_type == 'image':
            payload["type"] = "image"
            image_data = {}
            
            # Priorizar upload de mídia (recomendado pela Meta)
            if file_path and os.path.exists(file_path):
                # Fazer upload e obter media_id
                upload_success, media_id = upload_media_to_whatsapp(canal, file_path, 'image', mime_type or 'image/jpeg')
                if upload_success and media_id:
                    image_data["id"] = media_id
                else:
                    # Fallback para link se upload falhar
                    if file_url:
                        image_data["link"] = file_url
                    else:
                        return False, f"Erro ao fazer upload de mídia: {media_id}"
            elif file_url:
                # Usar link como fallback (não recomendado)
                image_data["link"] = file_url
            else:
                return False, "file_path ou file_url é obrigatório para imagens"
            
            if content:
                image_data["caption"] = content
            
            payload["image"] = image_data
            
        elif message_type == 'audio' or message_type == 'ptt':
            payload["type"] = "audio"
            audio_data = {}
            
            # Verificar formato do arquivo - Meta aceita apenas: MP3, OGG, AAC, AMR, M4A
            if file_path:
                file_ext = os.path.splitext(file_path)[1].lower()
            elif file_name:
                file_ext = os.path.splitext(file_name)[1].lower()
            else:
                file_ext = None
            
            # Formatos suportados pela Meta
            supported_formats = ['.mp3', '.ogg', '.aac', '.amr', '.m4a']
            if file_ext and file_ext not in supported_formats:
                # Arquivo não suportado - tentar usar como link ou retornar erro
                logger.warning(f"Formato de áudio não suportado pela Meta: {file_ext}. Formatos aceitos: {supported_formats}")
                if file_url:
                    # Tentar usar link como fallback (pode não funcionar)
                    audio_data["link"] = file_url
                    logger.warning(f"Usando link como fallback para formato não suportado: {file_ext}")
                else:
                    return False, f"Formato de áudio não suportado: {file_ext}. Formatos aceitos: MP3, OGG, AAC, AMR, M4A"
            
            # Detectar se é mensagem de voz (arquivo .ogg) ou áudio básico
            # Mensagens de voz devem ser arquivos .ogg codificados com codec OPUS
            if is_voice_message is None:
                # Auto-detectar baseado na extensão do arquivo
                if file_ext:
                    is_voice_message = (file_ext == '.ogg') or (message_type == 'ptt')
                else:
                    is_voice_message = (message_type == 'ptt')
            
            if file_path and os.path.exists(file_path):
                # Determinar MIME type correto para áudio
                detected_mime = mime_type or 'audio/mpeg'
                if not mime_type:
                    mime_map = {
                        '.mp3': 'audio/mpeg',
                        '.ogg': 'audio/ogg',
                        '.aac': 'audio/aac',
                        '.amr': 'audio/amr',
                        '.m4a': 'audio/mp4'
                    }
                    detected_mime = mime_map.get(file_ext, 'audio/mpeg')
                
                logger.info(f"[WhatsAppCloud] Fazendo upload de áudio: formato={file_ext}, mime={detected_mime}, voice={is_voice_message}")
                upload_success, media_id = upload_media_to_whatsapp(canal, file_path, 'audio', detected_mime)
                if upload_success and media_id:
                    audio_data["id"] = media_id
                    logger.info(f"[WhatsAppCloud] Upload de áudio bem-sucedido: media_id={media_id}")
                elif file_url:
                    audio_data["link"] = file_url
                    logger.warning(f"[WhatsAppCloud] Upload falhou, usando link como fallback")
                else:
                    error_msg = f"Erro ao fazer upload de mídia: {media_id}"
                    logger.error(f"[WhatsAppCloud] {error_msg}")
                    return False, error_msg
            elif file_url:
                audio_data["link"] = file_url
                logger.info(f"[WhatsAppCloud] Usando link para áudio: {file_url}")
            else:
                return False, "file_path ou file_url é obrigatório para áudio"
            
            # Adicionar campo "voice" se for mensagem de voz
            # Mensagens de voz são arquivos .ogg codificados com codec OPUS
            if is_voice_message:
                audio_data["voice"] = True
                logger.info(f"[WhatsAppCloud] Áudio configurado como mensagem de voz")
            
            payload["audio"] = audio_data
            
        elif message_type == 'video':
            payload["type"] = "video"
            video_data = {}
            
            # Verificar formato do arquivo - Meta aceita apenas: MP4 e 3GP
            if file_path:
                file_ext = os.path.splitext(file_path)[1].lower()
            elif file_name:
                file_ext = os.path.splitext(file_name)[1].lower()
            else:
                file_ext = None
            
            # Formatos suportados pela Meta para vídeo
            supported_formats = ['.mp4', '.3gp']
            if file_ext and file_ext not in supported_formats:
                logger.warning(f"Formato de vídeo não suportado pela Meta: {file_ext}. Formatos aceitos: {supported_formats}")
                if file_url:
                    # Tentar usar link como fallback (pode não funcionar)
                    video_data["link"] = file_url
                    logger.warning(f"Usando link como fallback para formato não suportado: {file_ext}")
                else:
                    return False, f"Formato de vídeo não suportado: {file_ext}. Formatos aceitos: MP4, 3GP. A Meta requer codec H.264 para vídeo e AAC para áudio."
            
            if file_path and os.path.exists(file_path):
                # Determinar MIME type correto para vídeo
                detected_mime = mime_type or 'video/mp4'
                if not mime_type:
                    mime_map = {
                        '.mp4': 'video/mp4',
                        '.3gp': 'video/3gpp'
                    }
                    detected_mime = mime_map.get(file_ext, 'video/mp4')
                
                logger.info(f"[WhatsAppCloud] Fazendo upload de vídeo: formato={file_ext}, mime={detected_mime}")
                upload_success, media_id = upload_media_to_whatsapp(canal, file_path, 'video', detected_mime)
                if upload_success and media_id:
                    video_data["id"] = media_id
                    logger.info(f"[WhatsAppCloud] Upload de vídeo bem-sucedido: media_id={media_id}")
                elif file_url:
                    video_data["link"] = file_url
                    logger.warning(f"[WhatsAppCloud] Upload falhou, usando link como fallback")
                else:
                    error_msg = f"Erro ao fazer upload de mídia: {media_id}"
                    logger.error(f"[WhatsAppCloud] {error_msg}")
                    return False, error_msg
            elif file_url:
                video_data["link"] = file_url
                logger.info(f"[WhatsAppCloud] Usando link para vídeo: {file_url}")
            else:
                return False, "file_path ou file_url é obrigatório para vídeo"
            
            if content:
                video_data["caption"] = content
            
            payload["video"] = video_data
            
        elif message_type == 'document':
            payload["type"] = "document"
            document_data = {}
            
            if file_path and os.path.exists(file_path):
                upload_success, media_id = upload_media_to_whatsapp(canal, file_path, 'document', mime_type or 'application/pdf')
                if upload_success and media_id:
                    document_data["id"] = media_id
                elif file_url:
                    document_data["link"] = file_url
                else:
                    return False, f"Erro ao fazer upload de mídia: {media_id}"
            elif file_url:
                document_data["link"] = file_url
            else:
                return False, "file_path ou file_url é obrigatório para documento"
            
            # Adicionar filename se fornecido (importante para WhatsApp exibir ícone correto)
            if file_name:
                document_data["filename"] = file_name
            elif file_path:
                # Extrair nome do arquivo do caminho se não fornecido
                document_data["filename"] = os.path.basename(file_path)
            
            # Adicionar caption se fornecido
            if content:
                document_data["caption"] = content
            
            payload["document"] = document_data
        elif message_type == 'order_details' or (message_type == 'interactive' and order_details):
            payload["type"] = "interactive"
            payload["interactive"] = {
                "type": "order_details",
                "body": {
                    "text": content
                },
                "action": {
                    "name": "review_and_pay",
                    "parameters": order_details
                }
            }
            
            footer_text = kwargs.get('footer')
            if footer_text:
                payload["interactive"]["footer"] = {"text": footer_text}

        elif message_type == 'interactive' and (buttons or kwargs.get('rows')):
            payload["type"] = "interactive"
            
            # Extrair metadados para interativos
            header_text = kwargs.get('header')
            footer_text = kwargs.get('footer')
            rows = kwargs.get('rows')
            button_text = kwargs.get('button_text', 'Ver Opções')
            section_title = kwargs.get('section_title', 'Selecione uma opção')
            
            interactive_payload: Dict[str, Any] = {}
            
            body_text = str(content)[:1024]
            header_val = str(header_text)[:60] if header_text else None
            footer_val = str(footer_text)[:1024] if footer_text else ""
            
            if rows:
                # WhatsApp List Message
                sections_payload: List[Dict[str, Any]] = []
                rows_payload: List[Dict[str, Any]] = []
                for row in rows[:10]: # WhatsApp permite no máximo 10 linhas
                    rows_payload.append({
                        "id": str(row.get('id', str(hash(row.get('title', ''))))),
                        "title": str(row.get('title', 'Opção'))[:24], # Máximo 24 caracteres
                        "description": str(row.get('description', ''))[:72] # Máximo 72 caracteres
                    })
                
                sections_payload.append({
                    "title": str(section_title)[:24], # Máximo 24 caracteres
                    "rows": rows_payload
                })
                
                interactive_payload = {
                    "type": "list",
                    "body": {
                        "text": body_text
                    },
                    "footer": {
                        "text": footer_val
                    },
                    "action": {
                        "button": str(button_text)[:20], # Texto do botão que abre a lista
                        "sections": sections_payload
                    }
                }

                if header_val:
                    interactive_payload["header"] = {
                        "type": "text",
                        "text": header_val
                    }
            else:
                # WhatsApp Reply Buttons
                buttons_payload: List[Dict[str, Any]] = []
                safe_buttons = buttons or []
                for btn in safe_buttons[:3]:  # WhatsApp permite no máximo 3 botões
                    buttons_payload.append({
                        "type": "reply",
                        "reply": {
                            "id": str(btn.get('id', str(hash(btn.get('title', ''))))),
                            "title": str(btn.get('title', 'Botão'))[:20]  # Limite de 20 caracteres
                        }
                    })
                
                interactive_payload = {
                    "type": "button",
                    "body": {
                        "text": body_text
                    },
                    "action": {
                        "buttons": buttons_payload
                    }
                }
                
                if header_text:
                    interactive_payload["header"] = {
                        "type": "text",
                        "text": header_val
                    }
                
                if footer_text:
                    interactive_payload["footer"] = {
                        "text": footer_val
                    }
            
            payload["interactive"] = interactive_payload
        else:
            # Fallback para texto
            payload["type"] = "text"
            payload["text"] = {
                "preview_url": False,
                "body": content
            }
        
        # Remover campos None do payload
        def remove_none(obj):
            if isinstance(obj, dict):
                return {k: remove_none(v) for k, v in obj.items() if v is not None}
            return obj
        
        payload = remove_none(payload)
        
        # Fazer requisição para API da Meta
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {canal.token}",
            "Content-Type": "application/json"
        }
        
        logger.info(f"[WhatsAppCloud] Enviando mensagem: type={message_type}, to={recipient_number}")
        logger.debug(f"[WhatsAppCloud] Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            response_data = response.json()
            logger.info(f"[WhatsAppCloud] Mensagem enviada com sucesso")
            return True, json.dumps(response_data)
        else:
            # Tentar extrair informações do erro
            error_data = {}
            try:
                error_data = response.json().get('error', {})
            except:
                error_data = {}
            
            error_code = error_data.get('code', response.status_code)
            error_subcode = error_data.get('error_subcode')
            error_message = error_data.get('message', response.text)
            error_details = error_data.get('error_data', {}).get('details', '')
            
            # Traduzir o erro para português
            translated_error = translate_whatsapp_error(error_code, error_subcode, error_message)
            
            # Retornar erro em formato JSON para incluir código e mensagem
            error_response = {
                'error_code': error_code,
                'error_message': translated_error,
                'original_message': error_message,
                'details': error_details
            }
            
            logger.error(f"[WhatsAppCloud] Erro ao enviar mensagem: HTTP {response.status_code} - Código: {error_code} - {translated_error}")
            return False, json.dumps(error_response)
    
    except Exception as e:
        return False, str(e)


def send_reaction(
    conversation,
    target_message_id: str,
    emoji: str
) -> Tuple[bool, Optional[str]]:
    """
    Envia uma reação (emoji) para uma mensagem recebida via WhatsApp Cloud API.
    
    De acordo com a documentação da Meta:
    - Apenas um webhook de mensagem enviada (com status "sent") será disparado
    - Não haverá webhooks de mensagens entregues e lidas
    - Se a mensagem tiver mais de 30 dias, não corresponder a nenhuma mensagem na conversa,
      tiver sido excluída ou já for uma mensagem de reação, a reação não será entregue
      e você receberá um webhook com código de erro 131009.
    
    Args:
        conversation: Objeto Conversation
        target_message_id: ID da mensagem do WhatsApp (wamid.HBgL...) que será reagida
        emoji: Emoji a ser aplicado (pode ser o próprio emoji ou sequência Unicode)
    
    Returns:
        tuple: (success: bool, response: str ou dict)
    """
    try:
        provedor = conversation.inbox.provedor
        
        # Buscar canal WhatsApp Oficial do provedor
        canal = Canal.objects.filter(
            provedor=provedor,
            tipo="whatsapp_oficial",
            ativo=True
        ).first()
        
        if not canal:
            return False, "Canal WhatsApp Oficial não encontrado"
        
        if not canal.token:
            return False, "Token do canal não configurado"
        
        if not canal.phone_number_id:
            return False, "Phone Number ID não configurado"
        
        # Obter número do destinatário do contato
        contact = conversation.contact
        recipient_number = contact.phone
        
        # Remover caracteres não numéricos
        recipient_number = ''.join(filter(str.isdigit, recipient_number))
        
        # Garantir que comece com código do país (se não tiver, assumir Brasil 55)
        if not recipient_number.startswith('55') and len(recipient_number) <= 11:
            recipient_number = '55' + recipient_number
        
        # Montar payload para reação
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_number,
            "type": "reaction",
            "reaction": {
                "message_id": target_message_id,
                "emoji": emoji
            }
        }
        
        # Fazer requisição para API da Meta
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {canal.token}",
            "Content-Type": "application/json"
        }
        
        logger.info(f"[WhatsAppCloud] Enviando reação: emoji={emoji}, message_id={target_message_id}, to={recipient_number}")
        logger.debug(f"[WhatsAppCloud] Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            response_data = response.json()
            logger.info(f"[WhatsAppCloud] Reação enviada com sucesso")
            return True, json.dumps(response_data)
        else:
            error_msg = response.text
            logger.error(f"[WhatsAppCloud] Erro ao enviar reação: HTTP {response.status_code} - {error_msg}")
            return False, error_msg
    
    except Exception as e:
        logger.error(f"[WhatsAppCloud] Exceção ao enviar reação: {str(e)}")
        return False, str(e)


def send_typing_indicator(canal: Canal, message_id: str) -> Tuple[bool, Optional[str]]:
    """
    Envia indicador de digitação (typing indicator) via API da Meta (WhatsApp).
    
    O indicador de digitação informa ao usuário que você está digitando uma resposta.
    O indicador será removido automaticamente quando você enviar uma mensagem ou após 25 segundos.
    
    IMPORTANTE: Apenas envie o indicador se você realmente for responder em breve.
    
    Args:
        canal: Objeto Canal com phone_number_id e token
        message_id: ID da mensagem do WhatsApp (wamid) que foi recebida
        
    Returns:
        Tuple[bool, Optional[str]]: (sucesso, mensagem_erro)
    """
    if not canal or not canal.phone_number_id or not canal.token:
        return False, "Canal, phone_number_id ou token não configurado"
    
    if not message_id:
        return False, "message_id não fornecido"
    
    try:
        # Preparar payload para API da Meta
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
            "typing_indicator": {
                "type": "text"
            }
        }
        
        # Fazer requisição para API da Meta
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {canal.token}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            if result.get("success"):
                logger.info(f"[WhatsAppTypingIndicator] Indicador de digitação enviado para mensagem {message_id}")
                return True, None
            else:
                error_msg = result.get("error", {}).get("message", "Erro desconhecido")
                logger.warning(f"[WhatsAppTypingIndicator] Erro ao enviar indicador: {error_msg}")
                return False, error_msg
        else:
            error_data = response.json() if response.content else {}
            error_info = error_data.get("error", {})
            error_code = error_info.get("code")
            error_message = error_info.get("message", "Erro desconhecido")
            error_type = error_info.get("type", "Unknown")
            
            translated_error = translate_whatsapp_error(error_code, error_message=error_message)
            logger.warning(
                f"[WhatsAppTypingIndicator] Falha ao enviar indicador (HTTP {response.status_code}): "
                f"{translated_error} (code: {error_code}, type: {error_type})"
            )
            return False, translated_error
            
    except requests.exceptions.Timeout:
        error_msg = "Timeout ao enviar indicador de digitação"
        logger.error(f"[WhatsAppTypingIndicator] {error_msg}")
        return False, error_msg
    except requests.exceptions.RequestException as e:
        error_msg = f"Erro de conexão ao enviar indicador: {str(e)}"
        logger.error(f"[WhatsAppTypingIndicator] {error_msg}")
        return False, error_msg
    except Exception as e:
        error_msg = f"Erro inesperado ao enviar indicador: {str(e)}"
        logger.error(f"[WhatsAppTypingIndicator] {error_msg}", exc_info=True)
        return False, error_msg


def mark_message_as_read(conversation, message_id: str) -> Tuple[bool, Optional[str]]:
    """
    Marca uma mensagem como lida na API da Meta (WhatsApp).
    
    De acordo com a documentação da Meta:
    - Marca a mensagem especificada como lida
    - Todas as mensagens anteriores no thread também são marcadas como lidas
    - Boa prática: marcar mensagens recebidas como lidas até 30 dias após a data de recebimento
    
    Args:
        conversation: Objeto Conversation
        message_id: ID da mensagem do WhatsApp (wamid.HBgL...) que foi recebida via webhook
    
    Returns:
        tuple: (success: bool, error_message: Optional[str])
    """
    try:
        provedor = conversation.inbox.provedor
        
        # Buscar canal WhatsApp Oficial do provedor
        canal = Canal.objects.filter(
            provedor=provedor,
            tipo="whatsapp_oficial",
            ativo=True
        ).first()
        
        if not canal:
            return False, "Canal WhatsApp Oficial não encontrado"
        
        if not canal.token:
            return False, "Token do canal não configurado"
        
        if not canal.phone_number_id:
            return False, "Phone Number ID não configurado"
        
        # Montar payload para marcar como lida
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id
        }
        
        # Fazer requisição para API da Meta
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {canal.token}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            response_data = response.json()
            if response_data.get("success", False):
                logger.info(f"Mensagem {message_id} marcada como lida com sucesso")
                return True, None
            else:
                error_msg = response_data.get("error", {}).get("message", "Erro desconhecido")
                logger.warning(f"Erro ao marcar mensagem como lida: {error_msg}")
                return False, error_msg
        else:
            error_msg = response.text
            logger.error(f"Erro HTTP {response.status_code} ao marcar mensagem como lida: {error_msg}")
            return False, error_msg
    
    except Exception as e:
        logger.error(f"Exceção ao marcar mensagem como lida: {str(e)}")
        return False, str(e)


def send_template_message(
    canal: Canal,
    recipient_number: str,
    template_name: str,
    template_language: str,
    template_components: Optional[List[Dict]] = None
) -> Tuple[bool, Optional[str], Optional[Dict]]:
    """
    Envia uma mensagem de template via WhatsApp Cloud API.
    Usado para iniciar conversas quando a janela de atendimento está fechada.
    
    Args:
        canal: Objeto Canal com token e phone_number_id configurados
        recipient_number: Número do destinatário (formato internacional, ex: 5511999999999)
        template_name: Nome do template aprovado
        template_language: Código do idioma do template (ex: pt_BR, en_US)
        template_components: Lista de componentes com parâmetros (opcional)
    
    Returns:
        tuple: (success: bool, error_message: Optional[str], response_data: Optional[Dict])
    """
    try:
        if not canal.token:
            return False, "Token do canal não configurado", None
        
        if not canal.phone_number_id:
            return False, "Phone Number ID não configurado", None
        
        # Manter apenas números e o sinal de '+' no início
        has_plus = recipient_number.startswith('+')
        recipient_number = ''.join(filter(lambda x: x.isdigit() or x == '+', recipient_number))
        
        # Se tinha '+' mas foi filtrado ou se não começa com '+', garantir formato correto
        if not recipient_number.startswith('+'):
            # Garantir que comece com código do país (se não tiver, assumir Brasil 55)
            if not recipient_number.startswith('55') and len(recipient_number) <= 11:
                recipient_number = '55' + recipient_number
            recipient_number = '+' + recipient_number
        
        # IMPORTANTE: A API da Meta aceita o formato original (pt_BR com underscore)
        # Não precisamos converter, usar o formato que vem da API de listagem
        language_code = template_language if template_language else 'pt_BR'
        
        # Log adicional para debug
        logger.info(f"[WhatsAppCloud] Idioma usado: {language_code}")
        
        # Montar payload
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_number,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": language_code
                }
            }
        }
        
        # Adicionar componentes se fornecidos
        if template_components:
            payload["template"]["components"] = template_components
        
        # Log do payload completo para debug
        logger.info(f"[WhatsAppCloud] Payload completo: {json.dumps(payload, indent=2, ensure_ascii=False)}")
        
        # Fazer requisição
        url = f"https://graph.facebook.com/{PHONE_NUMBERS_API_VERSION}/{canal.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {canal.token}",
            "Content-Type": "application/json"
        }
        
        logger.info(f"[WhatsAppCloud] Enviando template: name={template_name}, language={template_language} -> {language_code}, to={recipient_number}")
        logger.info(f"[WhatsAppCloud] Phone Number ID: {canal.phone_number_id}, WABA ID: {canal.waba_id}")
        logger.debug(f"[WhatsAppCloud] Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        logger.info(f"[WhatsAppCloud] Resposta da API: Status {response.status_code}")
        if response.status_code != 200:
            logger.error(f"[WhatsAppCloud] Resposta completa: {response.text}")
        
        if response.status_code == 200:
            response_data = response.json()
            logger.info(f"[WhatsAppCloud] Template enviado com sucesso")
            return True, None, response_data
        else:
            # Tentar extrair informações do erro
            error_data = {}
            try:
                error_data = response.json().get('error', {})
            except:
                error_data = {}
            
            error_code = error_data.get('code', response.status_code)
            error_subcode = error_data.get('error_subcode')
            error_message = error_data.get('message', response.text)
            
            # Traduzir o erro para português
            translated_error = translate_whatsapp_error(error_code, error_subcode, error_message)
            
            logger.error(f"[WhatsAppCloud] Erro ao enviar template: HTTP {response.status_code} - Código: {error_code} - {translated_error}")
            return False, translated_error, None
    
    except Exception as e:
        logger.exception(f"[WhatsAppCloud] Exceção ao enviar template: {str(e)}")
        return False, str(e), None