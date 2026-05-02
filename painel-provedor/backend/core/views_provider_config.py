from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions
from core.models import Provedor

class ProviderConfigView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        provedor = None
        tenant_provedor_id = getattr(request, "tenant_provedor_id", None)

        # Quando subdomínio estiver ativo e resolvido, prioriza o tenant context.
        if tenant_provedor_id:
            provedor = Provedor.objects.filter(id=tenant_provedor_id, is_active=True).first()
        
        # Tentar encontrar o provedor do usuário
        # Verificar se o usuário tem atributo 'provedor' (ForeignKey)
        if not provedor and hasattr(user, 'provedor') and user.provedor:
            provedor = user.provedor
        # Verificar se o usuário tem atributo 'provedor_id'
        elif not provedor and hasattr(user, 'provedor_id') and user.provedor_id:
             provedor = Provedor.objects.filter(id=user.provedor_id).first()
        
        # Se não encontrou diretamente, tentar via admins (relação ManyToMany)
        if not provedor:
            provedor = Provedor.objects.filter(admins=user).first()
            
        # Se for superadmin e ainda não tiver provedor, pegar o primeiro disponível (fallback)
        if not provedor and user.user_type == 'superadmin':
            provedor = Provedor.objects.first()

        if not provedor:
            return Response({'error': 'Provider not found'}, status=404)

        return Response({
            'id': provedor.id,
            'nome': provedor.nome,
            'chatbot_mode': provedor.bot_mode == 'chatbot',
            'bot_mode': provedor.bot_mode,
            'is_active': provedor.is_active
        })
