import logging
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


class LoggedTokenAuthentication(TokenAuthentication):
    """
    TokenAuthentication com logs detalhados para debug
    """
    
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        logger.debug(f"[AUTH] LoggedTokenAuthentication.authenticate chamado - Header: {auth_header[:30]}...")
        
        # Tentar autenticação padrão
        try:
            result = super().authenticate(request)
            
            if result:
                user, token = result
                logger.info(f"[AUTH] Autenticação bem-sucedida - user_id={user.id}, username={user.username}, token_key={token.key[:20]}...")
            else:
                logger.warning(f"[AUTH] Autenticação retornou None - Header: {auth_header[:30]}...")
            
            return result
        except AuthenticationFailed as e:
            logger.warning(f"[AUTH] AuthenticationFailed - {str(e)} - Header: {auth_header[:30]}...")
            raise
        except Exception as e:
            logger.error(f"[AUTH] Erro inesperado na autenticação: {e}", exc_info=True)
            raise
