from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes as permission_classes_decorator
from django.contrib.auth import authenticate
from .models import Provedor, Canal, User, Company, AuditLog, MensagemSistema, BillingTemplate, SystemConfig
from rest_framework import serializers

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        exclude = ['password']

class ProvedorSerializer(serializers.ModelSerializer):
    users_count = serializers.SerializerMethodField()
    conversations_count = serializers.SerializerMethodField()

    class Meta:
        model = Provedor
        fields = '__all__'

    def get_users_count(self, obj):
        try:
            return User.objects.filter(provedor=obj).count()
        except:
            return 0

    def get_conversations_count(self, obj):
        # Atualmente não temos acesso direto à tabela de conversas de cada provedor
        # Isso pode ser integrado depois. Por enquanto, retornamos 0 para o painel não quebrar.
        return 0

class CanalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Canal
        fields = '__all__'

class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = '__all__'

class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = '__all__'

class MensagemSistemaSerializer(serializers.ModelSerializer):
    class Meta:
        model = MensagemSistema
        fields = '__all__'

class BillingTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingTemplate
        fields = '__all__'

class SystemConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemConfig
        fields = '__all__'

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    def post(self, request):
        username = request.data.get('username')
        password = request.data.get('password')
        user = authenticate(username=username, password=password)
        if user:
            token, _ = Token.objects.get_or_create(user=user)
            return Response({'token': token.key})
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)

class UserMeView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

@api_view(['GET'])
@permission_classes_decorator([permissions.AllowAny])
def changelog_view(request):
    return Response([])

@api_view(['GET', 'POST'])
@permission_classes_decorator([permissions.AllowAny])
def ping_view(request):
    return Response({'status': 'pong'})

@api_view(['GET'])
@permission_classes_decorator([permissions.AllowAny])
def health_view(request):
    return Response({'status': 'healthy'})

import threading
import requests
import logging

logger = logging.getLogger(__name__)

def notify_provider_panel(provedor_id, is_active, status_text):
    try:
        config = SystemConfig.objects.first()
        if not config or not config.payload:
            return
        
        provider_url = config.payload.get('PROVIDER_PANEL_URL')
        webhook_secret = config.payload.get('ADMIN_WEBHOOK_SECRET')
        
        if not provider_url or not webhook_secret:
            logger.warning("Webhook do provedor nao configurado (PROVIDER_PANEL_URL ou ADMIN_WEBHOOK_SECRET faltando no SystemConfig).")
            return
            
        url = f"{provider_url.rstrip('/')}/api/webhooks/admin/provider-status/"
        payload = {
            "provedor_id": provedor_id,
            "is_active": is_active,
            "status": status_text,
            "secret": webhook_secret
        }
        
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()
        logger.info(f"Notificacao de status enviada com sucesso para provedor {provedor_id}")
    except Exception as e:
        logger.error(f"Erro ao notificar painel do provedor: {e}")

class ProvedorViewSet(viewsets.ModelViewSet):
    queryset = Provedor.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ProvedorSerializer

    def perform_update(self, serializer):
        instance = self.get_object()
        old_status = instance.status
        old_active = instance.is_active
        
        updated_instance = serializer.save()
        
        new_status = updated_instance.status
        new_active = updated_instance.is_active
        
        if old_status != new_status or old_active != new_active:
            thread = threading.Thread(target=notify_provider_panel, args=(updated_instance.id, new_active, new_status))
            thread.daemon = True
            thread.start()

class CanalViewSet(viewsets.ModelViewSet):
    queryset = Canal.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CanalSerializer

class CompanyViewSet(viewsets.ModelViewSet):
    queryset = Company.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CompanySerializer

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserSerializer

class AuditLogViewSet(viewsets.ModelViewSet):
    queryset = AuditLog.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AuditLogSerializer

class MensagemSistemaViewSet(viewsets.ModelViewSet):
    queryset = MensagemSistema.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MensagemSistemaSerializer

class BillingTemplateViewSet(viewsets.ModelViewSet):
    queryset = BillingTemplate.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = BillingTemplateSerializer

class SystemConfigView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk=None):
        config = SystemConfig.objects.first()
        if not config:
            return Response({})
        data = config.payload or {}
        data['id'] = config.id
        return Response(data)

    def put(self, request, pk=None):
        config = SystemConfig.objects.first()
        if not config:
            config = SystemConfig.objects.create(payload={})
        
        data = request.data.copy()
        data.pop('id', None)
        config.payload = data
        config.save()
        
        response_data = config.payload
        response_data['id'] = config.id
        return Response(response_data)
