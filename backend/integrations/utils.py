import requests
from django.conf import settings
from core.uazapi_client import UazapiClient


def send_whatsapp_message(phone, message, provedor):
    """
    Envia uma mensagem via WhatsApp usando a API da Uazapi
    
    Args:
        phone: Número do telefone (formato: 556392484773)
        message: Texto da mensagem
        provedor: Objeto Provedor com configurações da Uazapi
    
    Returns:
        bool: True se enviado com sucesso, False caso contrário
    """
    try:
        if not provedor or not provedor.integracoes_externas:
            return False
        
        token = provedor.integracoes_externas.get('whatsapp_token')
        uazapi_url = provedor.integracoes_externas.get('whatsapp_url')
        
        if not token or not uazapi_url:
            return False
        
        # Limpar o número do telefone
        clean_phone = phone.replace('@s.whatsapp.net', '').replace('@c.us', '')
        
        # URL para enviar mensagem
        if uazapi_url.endswith('/send/text'):
            send_url = uazapi_url
        else:
            send_url = f"{uazapi_url.rstrip('/')}/send/text"
        
        payload = {
            'number': clean_phone,
            'text': message
        }
        
        headers = {
            'token': token,
            'Content-Type': 'application/json'
        }
        
        response = requests.post(send_url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            return True
        else:
            return False
            
    except Exception as e:
        return False


def fetch_whatsapp_profile_picture(phone, instance_name, integration_type='evolution', provedor=None, is_client=True):
    """
    Busca a foto do perfil do WhatsApp de forma automática
    
    Args:
        phone: Número do telefone do contato
        instance_name: Nome da instância WhatsApp
        integration_type: 'evolution' ou 'uazapi'
        provedor: Objeto Provedor (necessário para Uazapi)
        is_client: True para buscar foto do cliente, False para buscar foto da instância conectada
    
    Returns:
        str: URL da foto do perfil ou None se não encontrada
    """
    
    # Limpar o número do telefone
    clean_phone = phone.replace('@s.whatsapp.net', '').replace('@c.us', '')
    
    if integration_type == 'evolution':
        if is_client:
            return _fetch_evolution_client_profile_picture(phone, instance_name)
        else:
            return _fetch_evolution_profile_picture(clean_phone, instance_name)
    elif integration_type == 'uazapi':
        return _fetch_uazapi_profile_picture(clean_phone, instance_name, provedor, is_client)
    else:
        return None


def _fetch_evolution_profile_picture(phone, instance_name):
    """Busca foto do perfil via Evolution API - mesma lógica do CanalSerializer"""
    try:
        # Usar a mesma lógica do CanalSerializer para buscar a foto do perfil
        url = f'{settings.EVOLUTION_URL}/instance/fetchInstances'
        headers = {'apikey': settings.EVOLUTION_API_KEY}
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            # Procurar pela instância específica
            for inst in data:
                if inst.get('name') == instance_name:
                    profile_pic = inst.get('profilePicUrl')
                    if profile_pic:
                        return profile_pic
                    else:
                        break
            
    except Exception as e:
        pass
    
    return None


def _fetch_evolution_client_profile_picture(phone, instance_name):
    """Busca foto do perfil do cliente via Evolution API - usando findContact"""
    try:
        # Buscar a foto do perfil do cliente específico
        contact_url = f"{settings.EVOLUTION_URL}/chat/findContact/{instance_name}"
        contact_data = {
            'number': phone.replace('@s.whatsapp.net', '').replace('@c.us', '')
        }
        headers = {'apikey': settings.EVOLUTION_API_KEY}
        
        response = requests.post(contact_url, headers=headers, json=contact_data, timeout=10)
        
        if response.status_code == 200:
            contact_info = response.json()
            profile_pic_url = contact_info.get('profilePicUrl')
            if profile_pic_url:
                return profile_pic_url
            
    except Exception as e:
        pass
    
    return None


def _fetch_uazapi_profile_picture(phone, instance_name, provedor, is_client=True):
    """
    Busca foto do perfil via Uazapi
    - Se is_client=True: usa /chat/details para buscar foto do contato
    - Se is_client=False: usa /instance/info para buscar foto da instância
    """
    try:
        if not provedor or not provedor.integracoes_externas:
            return None
        
        token = provedor.integracoes_externas.get('whatsapp_token')
        uazapi_url = provedor.integracoes_externas.get('whatsapp_url')
        
        if not token or not uazapi_url:
            return None
        
        client = UazapiClient(uazapi_url, token)
        
        if is_client:
            # Buscar foto do contato/cliente usando /chat/details
            contact_info = client.get_contact_info(instance_name, phone)
            
            if contact_info:
                # O endpoint /chat/details retorna a foto em diferentes campos
                profile_pic_url = (
                    contact_info.get('profilePicUrl') or
                    contact_info.get('wa_profilePicUrl') or
                    contact_info.get('profile_pic_url') or
                    contact_info.get('image') or
                    contact_info.get('avatar')
                )
                
                if profile_pic_url:
                    return profile_pic_url
        else:
            # Buscar foto da INSTÂNCIA usando /instance/info
            instance_info = client.get_instance_info(instance_name)
            
            if instance_info:
                # Buscar profilePicUrl de múltiplas fontes
                instance_data = instance_info.get('instance', {})
                if not instance_data and isinstance(instance_info, dict):
                    instance_data = instance_info
                
                profile_pic_url = (
                    instance_data.get('profilePicUrl') or
                    instance_info.get('profilePicUrl')
                )
                
                if profile_pic_url:
                    return profile_pic_url
            
    except Exception as e:
        pass
    
    return None


def update_contact_profile_picture(contact, instance_name, integration_type='evolution'):
    """
    Atualiza a foto do perfil de um contato automaticamente
    
    Args:
        contact: Objeto Contact
        instance_name: Nome da instância WhatsApp
        integration_type: 'evolution' ou 'uazapi'
    
    Returns:
        bool: True se a foto foi atualizada, False caso contrário
    """
    
    # Se já tem avatar, não precisa buscar
    if contact.avatar:
        return False
    
    # Determinar o tipo de integração baseado no provedor se não especificado
    if integration_type == 'auto':
        if contact.provedor and contact.provedor.integracoes_externas:
            if contact.provedor.integracoes_externas.get('whatsapp_url'):
                integration_type = 'uazapi'
            else:
                integration_type = 'evolution'
        else:
            integration_type = 'evolution'
    
    # Buscar a foto do perfil do cliente
    profile_pic_url = fetch_whatsapp_profile_picture(
        phone=contact.phone,
        instance_name=instance_name,
        integration_type=integration_type,
        provedor=contact.provedor,
        is_client=True  # Buscar foto do cliente
    )
    
    if profile_pic_url:
        # Validar se a URL é acessível
        try:
            response = requests.head(profile_pic_url, timeout=5)
            if response.status_code == 200:
                contact.avatar = profile_pic_url
                contact.save()
                return True
            else:
                return False
        except Exception as e:
            return False
    else:
        return False 