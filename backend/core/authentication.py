import logging
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.authtoken.models import Token

logger = logging.getLogger(__name__)


class LoggedTokenAuthentication(TokenAuthentication):
    """
    TokenAuthentication com logs detalhados para debug
    """
    
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        logger.debug(f"[AUTH] LoggedTokenAuthentication.authenticate chamado - Header: {auth_header[:30]}...")
        
        # Extrair token do header para verificar no banco se falhar
        token_key = None
        if auth_header.startswith('Token '):
            token_key = auth_header.replace('Token ', '').strip()
        
        # Tentar autenticação padrão
        try:
            result = super().authenticate(request)
            
            if result:
                user, token = result
                logger.info(f"[AUTH] Autenticação bem-sucedida - user_id={user.id}, username={user.username}, token_key={token.key[:20]}...")
            else:
                logger.warning(f"[AUTH] Autenticação retornou None - Header: {auth_header[:30]}...")
                # Verificar se o token existe no banco
                if token_key:
                    try:
                        db_token = Token.objects.select_related('user').get(key=token_key)
                        logger.error(f"[AUTH] CRÍTICO: Token existe no banco mas autenticação retornou None! user_id={db_token.user.id}, username={db_token.user.username}, is_active={db_token.user.is_active}")
                    except Token.DoesNotExist:
                        logger.debug(f"[AUTH] Token não encontrado no banco: {token_key[:20]}...")
                    except Exception as e:
                        logger.error(f"[AUTH] Erro ao verificar token no banco: {e}", exc_info=True)
            
            return result
        except AuthenticationFailed as e:
            logger.warning(f"[AUTH] AuthenticationFailed - {str(e)} - Header: {auth_header[:30]}...")
            # Verificar se o token existe no banco quando falha
            if token_key:
                try:
                    db_token = Token.objects.select_related('user').get(key=token_key)
                    logger.error(f"[AUTH] CRÍTICO: Token existe no banco mas autenticação falhou! user_id={db_token.user.id}, username={db_token.user.username}, is_active={db_token.user.is_active}, token_key={token_key[:20]}...")
                    # Verificar se o usuário está ativo
                    if not db_token.user.is_active:
                        logger.error(f"[AUTH] Usuário está inativo! user_id={db_token.user.id}")
                except Token.DoesNotExist:
                    logger.debug(f"[AUTH] Token não encontrado no banco (esperado): {token_key[:20]}...")
                except Exception as e:
                    logger.error(f"[AUTH] Erro ao verificar token no banco: {e}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"[AUTH] Erro inesperado na autenticação: {e}", exc_info=True)
            raise
