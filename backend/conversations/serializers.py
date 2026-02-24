from rest_framework import serializers
from .models import Contact, Inbox, Conversation, Message, Team, TeamMember, CSATFeedback, CSATRequest, MessageReaction
from core.serializers import UserSerializer, LabelSerializer


class ContactSerializer(serializers.ModelSerializer):
    inbox = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    
    class Meta:
        model = Contact
        fields = [
            'id', 'name', 'email', 'phone', 'avatar',
            'additional_attributes', 'provedor', 'created_at', 'updated_at', 'inbox',
            'bloqueado_atender', 'bloqueado_disparos'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def validate_email(self, value):
        """Permite string vazia e converte para None (EmailField aceita null, não '')."""
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return None
        return value
    
    def validate_phone(self, value):
        """Normaliza telefone: remove espaços."""
        if value is None:
            return ''
        return str(value).strip().replace(' ', '') if value else ''
    
    def get_inbox(self, obj):
        # Buscar a conversa mais recente do contato
        latest_conversation = obj.conversations.order_by('-last_message_at').first()
        if latest_conversation and latest_conversation.inbox:
            return InboxSerializer(latest_conversation.inbox).data
        return None
    
    def get_avatar(self, obj):
        """Retorna a URL do avatar, usando a mesma lógica do canal Telegram"""
        # Se já tem avatar (WhatsApp), retornar diretamente
        if obj.avatar:
            return obj.avatar
        
        # Se tem foto do Telegram salva em additional_attributes (mesma lógica do canal)
        if obj.additional_attributes and obj.additional_attributes.get('telegram_photo'):
            # Retornar diretamente como data URL (mesmo formato usado no canal)
            return obj.additional_attributes.get('telegram_photo')
        
        # Retornar None se não tiver foto
        return None


class InboxSerializer(serializers.ModelSerializer):
    class Meta:
        model = Inbox
        fields = [
            'id', 'name', 'channel_type', 'channel_id', 'provedor',
            'is_active', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class MessageReactionSerializer(serializers.ModelSerializer):
    """Serializer para reações de mensagens"""
    class Meta:
        model = MessageReaction
        fields = ['id', 'emoji', 'is_from_customer', 'created_at', 'external_id']
        read_only_fields = ['id', 'created_at']


class MessageSerializer(serializers.ModelSerializer):
    media_type = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    sender = serializers.SerializerMethodField()
    from_ai = serializers.SerializerMethodField()
    reactions = MessageReactionSerializer(many=True, read_only=True)

    class Meta:
        model = Message
        fields = [
            'id', 'conversation', 'message_type',
            'media_type', 'file_url',
            'content', 'is_from_customer', 'created_at', 'external_id', 'additional_attributes',
            'sender', 'from_ai', 'reactions'
        ]
        read_only_fields = ['id', 'created_at']

    def get_media_type(self, obj):
        # Garante que sempre retorna o tipo de mídia correto
        return obj.message_type

    def get_file_url(self, obj):
        # PRIORIDADE 1: URL local (arquivo já baixado e salvo no servidor)
        if obj.additional_attributes:
            local_url = obj.additional_attributes.get('local_file_url')
            if local_url:
                return local_url
        
        # PRIORIDADE 2: file_url do modelo (pode ser local ou externo)
        if obj.file_url:
            # Se for URL relativa/local, usar diretamente
            if not obj.file_url.startswith('http://') and not obj.file_url.startswith('https://'):
                return obj.file_url
            # Se for URL completa mas não for do Meta (evita CORS), usar
            if isinstance(obj.file_url, str) and not ('lookaside.fbsbx.com' in obj.file_url or 'facebook.com' in obj.file_url):
                return obj.file_url
        
        # PRIORIDADE 3: URL da Uazapi (se não for Meta)
        if obj.additional_attributes:
            uazapi_url = obj.additional_attributes.get('file_url')
            if uazapi_url and (uazapi_url.startswith('http://') or uazapi_url.startswith('https://')):
                # Não retornar URLs do Meta diretamente (causam CORS)
                if not ('lookaside.fbsbx.com' in uazapi_url or 'facebook.com' in uazapi_url):
                    return uazapi_url
        
        # Fallback: whatsapp_file_url (URL do Meta) - só como último recurso
        # Nota: Esta URL causará CORS se usada diretamente no frontend
        # O ideal é que os arquivos sejam baixados localmente quando chegam via webhook
        if obj.additional_attributes:
            whatsapp_url = obj.additional_attributes.get('whatsapp_file_url')
            if whatsapp_url:
                return whatsapp_url
            
        return None
    
    def get_sender(self, obj):
        """
        Identifica o tipo de sender da mensagem
        """
        if obj.is_from_customer:
            return {'sender_type': 'customer'}
        
        # Verificar se é mensagem da IA
        # Mensagens da IA geralmente não têm assignee e são criadas automaticamente
        if obj.additional_attributes and obj.additional_attributes.get('from_ai'):
            return {'sender_type': 'ai'}
        
        # Verificar se a mensagem foi criada automaticamente (sem usuário associado)
        # e não é do cliente (provavelmente é da IA)
        if not hasattr(obj, 'sender') or obj.sender is None:
            # Se não tem sender e não é do cliente, provavelmente é da IA
            return {'sender_type': 'ai'}
        
        return {'sender_type': 'agent'}
    
    def get_from_ai(self, obj):
        """
        Indica se a mensagem foi enviada pela IA
        """
        if obj.is_from_customer:
            return False
        
        # Verificar nos atributos adicionais
        if obj.additional_attributes and obj.additional_attributes.get('from_ai'):
            return True
        
        # Se não tem sender e não é do cliente, provavelmente é da IA
        # NOTA: Message model não tem campo sender, então esta verificação sempre será True
        # para mensagens não-cliente. Vamos remover esta lógica para evitar falsos positivos.
        # if not hasattr(obj, 'sender') or obj.sender is None:
        #     return True
        
        return False

    def create(self, validated_data):
        validated_data['is_from_customer'] = False
        return super().create(validated_data)


class ConversationSerializer(serializers.ModelSerializer):
    # Para criação, usamos IDs simples
    contact_id = serializers.IntegerField(write_only=True, required=False)
    inbox_id = serializers.IntegerField(write_only=True, required=False)
    assignee_id = serializers.IntegerField(write_only=True, required=False)
    team_id = serializers.IntegerField(write_only=True, required=False)
    
    # Para leitura, usamos objetos completos
    contact = ContactSerializer(read_only=True)
    inbox = InboxSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    team = serializers.SerializerMethodField()
    labels = LabelSerializer(many=True, read_only=True)
    messages = MessageSerializer(many=True, read_only=True)
    
    # Garantir que additional_attributes seja writeable
    additional_attributes = serializers.JSONField(required=False)
    
    # Campos para verificação da janela de 24 horas
    last_user_message_at = serializers.DateTimeField(read_only=True)
    is_24h_window_open = serializers.SerializerMethodField()
    
    class Meta:
        model = Conversation
        fields = [
            'id', 'contact', 'inbox', 'assignee', 'team', 'status',
            'contact_id', 'inbox_id', 'assignee_id', 'team_id',
            'labels', 'additional_attributes',
            'last_message_at', 'last_user_message_at', 'is_24h_window_open', 'created_at', 'messages'
        ]
        read_only_fields = ['id', 'last_message_at', 'last_user_message_at', 'created_at']
    
    def get_team(self, obj):
        """Retorna dados do time se existir"""
        if obj.team:
            return {
                'id': obj.team.id,
                'name': obj.team.name,
                'description': obj.team.description
            }
        return None
    
    def get_is_24h_window_open(self, obj):
        """Retorna se a janela de 24 horas está aberta"""
        return obj.is_24h_window_open()
    
    def create(self, validated_data):
        # Extrair os campos _id mas manter no validated_data com nome correto
        contact_id = validated_data.pop('contact_id', None)
        inbox_id = validated_data.pop('inbox_id', None)
        assignee_id = validated_data.pop('assignee_id', None)
        team_id = validated_data.pop('team_id', None)
        
        # Buscar as instâncias dos objetos relacionados
        if contact_id:
            from .models import Contact
            validated_data['contact'] = Contact.objects.get(id=contact_id)
        if inbox_id:
            from .models import Inbox
            validated_data['inbox'] = Inbox.objects.get(id=inbox_id)
        if assignee_id:
            from core.models import User
            validated_data['assignee'] = User.objects.get(id=assignee_id)
        if team_id:
            from .models import Team
            validated_data['team'] = Team.objects.get(id=team_id)
            
        return super().create(validated_data)
    
    def update(self, instance, validated_data):
        # Extrair os campos _id se presentes
        contact_id = validated_data.pop('contact_id', None)
        inbox_id = validated_data.pop('inbox_id', None)
        assignee_id = validated_data.pop('assignee_id', None)
        team_id = validated_data.pop('team_id', None)
        
        # Atualizar as instâncias dos objetos relacionados se fornecidos
        if contact_id is not None:
            from .models import Contact
            validated_data['contact'] = Contact.objects.get(id=contact_id) if contact_id else None
        if inbox_id is not None:
            from .models import Inbox
            validated_data['inbox'] = Inbox.objects.get(id=inbox_id) if inbox_id else None
        if assignee_id is not None:
            from core.models import User
            validated_data['assignee'] = User.objects.get(id=assignee_id) if assignee_id else None
        if team_id is not None:
            from .models import Team
            validated_data['team'] = Team.objects.get(id=team_id) if team_id else None
        
        # Garantir que additional_attributes seja atualizado corretamente
        if 'additional_attributes' in validated_data:
            instance.additional_attributes = validated_data['additional_attributes']
            validated_data.pop('additional_attributes')  # Remove para evitar conflito
            
        # Atualizar outros campos
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
            
        instance.save()
        return instance


class ConversationUpdateSerializer(serializers.ModelSerializer):
    """Serializer para atualização de conversas, permitindo modificar assignee e status"""
    assignee_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Conversation
        fields = ['assignee', 'assignee_id', 'status']
        read_only_fields = ['assignee']

    def update(self, instance, validated_data):
        # Suporte a assignee_id para facilitar PATCHs do frontend
        assignee_id = validated_data.pop('assignee_id', None)
        if assignee_id is not None:
            from core.models import User
            instance.assignee = User.objects.get(id=assignee_id) if assignee_id else None
        
        # Atualizar status se fornecido
        status_value = validated_data.get('status', None)
        if status_value is not None:
            instance.status = status_value
        
        instance.save()
        return instance


class ConversationListSerializer(serializers.ModelSerializer):
    """Serializer simplificado para listagem de conversas"""
    contact = ContactSerializer(read_only=True)
    inbox = InboxSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    team = serializers.SerializerMethodField()
    labels = LabelSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Conversation
        fields = [
            'id', 'contact', 'inbox', 'assignee', 'team', 'status',
            'labels', 'additional_attributes', 'last_message_at', 'created_at',
            'last_message', 'unread_count'
        ]
        read_only_fields = ['id', 'last_message_at', 'created_at']
    
    def get_last_message(self, obj):
        # Otimização: usar prefetch se disponível (evita query extra)
        if hasattr(obj, 'last_message_prefetched') and obj.last_message_prefetched:
            return MessageSerializer(obj.last_message_prefetched[0]).data
        # Fallback: buscar do banco se não tiver prefetch
        last_message = obj.messages.last()
        if last_message:
            return MessageSerializer(last_message).data
        return None
    
    def get_unread_count(self, obj):
        # Implementar lógica de contagem de mensagens não lidas
        return 0

    def get_team(self, obj):
        """Retorna dados do time se existir"""
        if obj.team:
            return {
                'id': obj.team.id,
                'name': obj.team.name,
                'description': obj.team.description
            }
        return None


class TeamMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    class Meta:
        model = TeamMember
        fields = ['id', 'user', 'role', 'joined_at']
        read_only_fields = ['id', 'joined_at']

class TeamSerializer(serializers.ModelSerializer):
    members = TeamMemberSerializer(many=True, read_only=True)
    class Meta:
        model = Team
        fields = [
            'id', 'name', 'description', 'provedor', 'members',
            'is_active', 'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'provedor']


class CSATFeedbackSerializer(serializers.ModelSerializer):
    """
    Serializer para feedbacks CSAT
    """
    contact_name = serializers.CharField(source='contact.name', read_only=True)
    contact_phone = serializers.CharField(source='contact.phone', read_only=True)
    contact_photo = serializers.SerializerMethodField()
    rating_display = serializers.CharField(source='get_emoji_rating_display', read_only=True)
    
    def get_contact_photo(self, obj):
        """
        Busca a foto do contato usando a API da Uazapi
        """
        try:
            from core.uazapi_client import UazapiClient
            import logging
            
            logger = logging.getLogger(__name__)
            
            # Verificar se é canal WhatsApp
            if obj.channel_type != 'whatsapp':
                return obj.contact.avatar  # Retorna avatar padrão se não for WhatsApp
            
            # Obter configurações do provedor
            config = obj.provedor.integracoes_externas
            if not config:
                logger.warning(f"No external integrations found for provider {obj.provedor.id}")
                return obj.contact.avatar
            
            whatsapp_url = config.get('whatsapp_url')
            whatsapp_token = config.get('whatsapp_token')
            whatsapp_instance = config.get('whatsapp_instance')
            
            if not whatsapp_url or not whatsapp_token or not whatsapp_instance:
                logger.warning(f"WhatsApp configuration incomplete for provider {obj.provedor.id}")
                return obj.contact.avatar
            
            # Criar cliente Uazapi
            uazapi_client = UazapiClient(
                base_url=whatsapp_url,
                token=whatsapp_token
            )
            
            # Buscar informações do contato
            contact_info = uazapi_client.get_contact_info(
                instance_id=whatsapp_instance,
                phone=obj.contact.phone
            )
            
            if contact_info and contact_info.get('image'):
                # Atualizar avatar do contato no banco para cache
                obj.contact.avatar = contact_info['image']
                obj.contact.save(update_fields=['avatar'])
                
                logger.info(f"Updated contact {obj.contact.id} avatar from Uazapi")
                return contact_info['image']
            else:
                logger.info(f"No profile picture found for contact {obj.contact.phone}")
                return obj.contact.avatar
                
        except Exception as e:
            logger.error(f"Error fetching contact photo from Uazapi: {e}")
            return obj.contact.avatar  # Fallback para avatar padrão
    
    class Meta:
        model = CSATFeedback
        fields = [
            'id', 'conversation', 'contact', 'contact_name', 'contact_phone', 'contact_photo',
            'emoji_rating', 'rating_value', 'rating_display', 'channel_type',
            'feedback_sent_at', 'conversation_ended_at', 'response_time_minutes',
            'original_message', 'additional_data'
        ]
        read_only_fields = [
            'id', 'feedback_sent_at', 'contact_name', 'contact_phone', 'rating_display'
        ]


class CSATRequestSerializer(serializers.ModelSerializer):
    """
    Serializer para solicitações de CSAT
    """
    contact_name = serializers.CharField(source='contact.name', read_only=True)
    contact_phone = serializers.CharField(source='contact.phone_number', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = CSATRequest
        fields = [
            'id', 'conversation', 'contact', 'contact_name', 'contact_phone',
            'status', 'status_display', 'conversation_ended_at', 'scheduled_send_at',
            'sent_at', 'responded_at', 'channel_type', 'csat_feedback',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'contact_name', 'contact_phone', 'status_display',
            'created_at', 'updated_at'
        ]


class CSATStatsSerializer(serializers.Serializer):
    """
    Serializer para estatísticas do dashboard CSAT
    """
    total_feedbacks = serializers.IntegerField()
    average_rating = serializers.FloatField()
    satisfaction_rate = serializers.FloatField()
    rating_distribution = serializers.ListField()
    channel_distribution = serializers.ListField()
    daily_stats = serializers.ListField()
    recent_feedbacks = CSATFeedbackSerializer(many=True, read_only=True)

