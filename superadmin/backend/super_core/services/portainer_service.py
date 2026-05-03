import json
import logging
import os
import re
import requests
from django.conf import settings
from ..models import SystemConfig, User

logger = logging.getLogger(__name__)

class PortainerService:
    def __init__(self, vps):
        self.vps = vps
        self.api_url = self.vps.api_url.rstrip('/')
        self.token = self.vps.portainer_api_key
        self.endpoint_id = self.vps.endpoint_id
        self.headers = {
            "X-API-Key": self.token,
            "Content-Type": "application/json"
        }

    def _prepare_compose(self, subdomain, provedor=None):
        """
        Lê o docker-compose do painel do provedor e prepara para o deploy do cliente.
        """
        try:
            # Template: niohub/painel-provedor/docker-compose.yml (BASE_DIR = superadmin/backend/)
            base_dir = str(settings.BASE_DIR)
            root_dir = os.path.dirname(os.path.dirname(base_dir))
            compose_path = os.path.join(root_dir, 'painel-provedor', 'docker-compose.yml')
            
            logger.info(f"Lendo template de: {compose_path}")
            
            with open(compose_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # 1. Remover container_name para evitar conflitos se houver + de 1 provedor na mesma VPS
            # O Portainer vai usar o nome da Stack como prefixo automaticamente.
            content = re.sub(r'^\s*container_name:.*$', '', content, flags=re.MULTILINE)
            # No Swarm, aliases em redes externas podem causar erros de deploy/rejeição.
            content = re.sub(r'^\s*aliases:.*$', '', content, flags=re.MULTILINE)
            content = re.sub(r'^\s*-\s*niochat_postgres.*$', '', content, flags=re.MULTILINE)
            # Em multi-tenant, não podemos expor a porta 5432 no host para cada stack (conflito).
            # Removemos a seção de portas do postgres.
            content = re.sub(r'^\s*ports:.*?\n\s*-\s*"5432:5432".*?\n', '\n', content, flags=re.DOTALL | re.MULTILINE)

            # 2. Substituir domínios fixos pelo subdomínio do cliente
            # Alvo: Host(`api.niohub.com.br`) || Host(`chat.niohub.com.br`)
            content = content.replace('api.niohub.com.br', subdomain)
            content = content.replace('chat.niohub.com.br', subdomain)
            
            # 3. Normalizar referências à rede interna (nethub)
            content = re.sub(r'(?i)NioNet', 'nethub', content)
            content = content.replace('nioNet:', 'nethub:')
            content = content.replace('Nionet:', 'nethub:')

            # 4. Tag de imagem do painel (stable vs beta-prov) — evita depender de interpolação no Swarm
            provider_tag = (
                'beta-prov' if provedor and getattr(provedor, 'release_channel', None) == 'beta' else 'stable'
            )
            content = content.replace('${PROVIDER_IMAGE_TAG:-stable}', provider_tag)

            return content
        except Exception as e:
            logger.error(f"Erro ao preparar docker-compose: {e}")
            raise

    def deploy_provider_stack(self, provedor):
        """
        Cria ou atualiza a Stack do provedor no Portainer remoto.
        """
        # Garante que a Registry do GitHub está configurada na VPS
        self._ensure_registry()
        # Garante que a rede overlay nethub existe no swarm antes do deploy
        self._ensure_network('nethub')
        
        subdomain = provedor.subdomain
        if not subdomain:
            logger.error(f"Provedor {provedor.nome} não tem subdomínio definido.")
            return False

        slug = subdomain.split('.')[0]
        stack_name = f"niohub-{slug}"
        
        try:
            compose_content = self._prepare_compose(subdomain, provedor)
            
            # Verificar se a stack já existe
            list_url = f"{self.api_url}/api/stacks"
            res = requests.get(list_url, headers=self.headers, timeout=10, verify=False)
            if res.status_code != 200:
                logger.error(f"Erro ao listar stacks do Portainer ({res.status_code}): {res.text}")
                return False
                
            stacks = res.json()
            if not isinstance(stacks, list):
                logger.error(f"Resposta inesperada do Portainer (não é uma lista): {stacks}")
                return False
            
            # Log de debug para ver quais stacks vieram
            stack_names = [s.get('Name') for s in stacks]
            logger.info(f"Stacks existentes no Portainer: {stack_names}")
            
            existing_stack = next((s for s in stacks if s.get('Name') == stack_name), None)

            if existing_stack:
                # UPDATE STACK
                logger.info(f"Atualizando stack existente: {stack_name}")
                stack_id = existing_stack['Id']
                # pullImage=true na URL força o Portainer a baixar a imagem nova do Registry (GHCR)
                update_url = f"{self.api_url}/api/stacks/{stack_id}?endpointId={self.endpoint_id}&pullImage=true"
                existing_env = existing_stack.get('Env')
                payload = {
                    "stackFileContent": compose_content,
                    "env": self._get_env_vars(provedor, slug, existing_env=existing_env),
                    "prune": True,
                    "pullImage": True
                }
                
                response = requests.put(update_url, json=payload, headers=self.headers, timeout=90, verify=False)
            else:
                # CREATE STACK
                swarm_id = self._get_swarm_id()
                
                if swarm_id:
                    logger.info(f"Criando nova stack (Modo Swarm): {stack_name}")
                    create_url = f"{self.api_url}/api/stacks/create/swarm/string?endpointId={self.endpoint_id}&pullImage=true"
                    payload = {
                        "name": stack_name,
                        "swarmID": swarm_id,
                        "stackFileContent": compose_content,
                        "env": self._get_env_vars(provedor, slug, existing_env=None),
                        "pullImage": True
                    }
                else:
                    logger.info(f"Criando nova stack (Modo Standalone): {stack_name} (SwarmID não detectado)")
                    create_url = f"{self.api_url}/api/stacks/create/standalone/string?endpointId={self.endpoint_id}&pullImage=true"
                    payload = {
                        "name": stack_name,
                        "stackFileContent": compose_content,
                        "env": self._get_env_vars(provedor, slug, existing_env=None),
                        "pullImage": True
                    }
                
                response = requests.post(create_url, json=payload, headers=self.headers, timeout=60, verify=False)

            if response.status_code in [200, 201]:
                logger.info(f"Deploy concluído com sucesso para {stack_name} na VPS {self.vps.name}")
                return True
            else:
                logger.error(f"Erro no Portainer ({response.status_code}): {response.text}")
                # Log do payload para debug em caso de erro (omitindo segredos sensíveis)
                logger.debug(f"Payload enviado: {json.dumps({k:v for k,v in payload.items() if k != 'stackFileContent'})}")
                return False

        except Exception as e:
            logger.error(f"Falha crítica no deploy do Portainer: {e}", exc_info=True)
            return False

    def _ensure_network(self, network_name='nethub'):
        """
        Garante que a rede overlay Swarm-scoped existe na VPS antes do deploy.
        Se não existir, cria automaticamente via Docker Engine (proxy Portainer).
        A rede precisa ser 'overlay' e 'attachable' para funcionar com Swarm stacks.
        """
        try:
            # 1. Listar redes via Docker Engine proxy do Portainer
            nets_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/networks"
            res = requests.get(nets_url, headers=self.headers, timeout=10, verify=False)
            if res.status_code != 200:
                logger.warning(f"Não foi possível listar redes Docker ({res.status_code}). Tentando continuar...")
                return

            networks = res.json()
            # A resposta pode ser lista ou dict (Portainer < vs >= 2.20)
            if isinstance(networks, dict):
                networks = list(networks.values())

            # Verificar se já existe (por nome)
            existing = next(
                (n for n in networks if n.get('Name') == network_name),
                None
            )

            if existing:
                scope = existing.get('Scope', '')
                driver = existing.get('Driver', '')
                attachable = existing.get('Attachable', False)
                if driver == 'overlay':
                    logger.info(f"Rede '{network_name}' já existe e é overlay. OK.")
                    return
                else:
                    logger.warning(f"Rede '{network_name}' existe mas não é overlay ({driver}). Removendo para recriar...")
                    delete_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/networks/{existing['Id']}"
                    res_del = requests.delete(delete_url, headers=self.headers, timeout=10, verify=False)
                    if res_del.status_code in [200, 204]:
                        import time
                        logger.info("Aguardando 3 segundos para propagação da remoção da rede...")
                        time.sleep(3)
                    else:
                        logger.error(f"Falha ao remover rede antiga ({res_del.status_code}): {res_del.text}")
                        return

            # 2. Criar a rede overlay swarm-scoped
            logger.info(f"Criando rede overlay Swarm '{network_name}'...")
            create_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/networks/create"
            payload = {
                "Name": network_name,
                "Driver": "overlay",
                "CheckDuplicate": True,
                "Internal": False,
                "Attachable": True,
                "IPAM": {
                    "Config": [{"Subnet": "172.28.0.0/16", "Gateway": "172.28.0.1"}]
                }
            }
            res_create = requests.post(create_url, json=payload, headers=self.headers, timeout=15, verify=False)
            if res_create.status_code in [200, 201]:
                net_id = res_create.json().get('Id', '?')
                logger.info(f"Rede '{network_name}' criada com sucesso! ID={net_id}")
            else:
                # Se falhar com IPAM, tenta sem IPAM fixo
                payload.pop('IPAM')
                res_create = requests.post(create_url, json=payload, headers=self.headers, timeout=15, verify=False)
                if res_create.status_code in [200, 201]:
                    logger.info(f"Rede '{network_name}' criada com sucesso (IPAM automático)!")
                else:
                    logger.error(f"Falha ao criar rede '{network_name}' ({res_create.status_code}): {res_create.text}")
        except Exception as e:
            logger.error(f"Erro ao garantir rede '{network_name}': {e}")


    def _get_env_vars(self, provedor, slug, existing_env=None):
        """
        Gera a lista de variáveis de ambiente para a stack.

        Em *update* de stack existente, repõe POSTGRES_PASSWORD / DATABASE_URL / SECRET_KEY
        a partir do env já guardado no Portainer. O volume do Postgres só aceita a senha
        definida na primeira subida; gerar senha nova em cada deploy quebra o login.
        """
        import os
        import secrets
        from urllib.parse import quote_plus

        existing = {}
        if existing_env:
            for item in existing_env:
                if isinstance(item, dict) and item.get('name'):
                    existing[item['name']] = item.get('value') or ''

        db_name = f"niochat_{slug}"
        db_user = "niochat_user"
        epass = existing.get('POSTGRES_PASSWORD')
        edb = existing.get('POSTGRES_DB')
        if epass and edb == db_name:
            db_pass = epass
            if existing.get('POSTGRES_USER'):
                db_user = existing['POSTGRES_USER']
            logger.info(
                'Reutilizando credenciais Postgres da stack no Portainer (volume já inicializado).'
            )
        else:
            db_pass = secrets.token_urlsafe(16)

        secret_key = existing.get('SECRET_KEY') or secrets.token_urlsafe(32)
        database_url = (
            f'postgresql://{quote_plus(db_user)}:{quote_plus(db_pass)}'
            f'@postgres:5432/{db_name}'
        )
        
        # Dados de infraestrutura vêm agora do VpsServer (compartilhado)
        # Se estiverem vazios, tenta descobrir via API do Portainer
        redis_host = self.vps.redis_host
        redis_pass = self.vps.redis_password
        rabbitmq_url = self.vps.rabbitmq_url
        
        if not redis_host or not rabbitmq_url or redis_host == 'localhost':
            logger.info("Credenciais de infraestrutura incompletas. Tentando auto-descoberta via Portainer...")
            discovered = self._discover_infrastructure()
            if discovered:
                redis_host = discovered.get('redis_host', redis_host)
                redis_pass = discovered.get('redis_password', redis_pass)
                rabbitmq_url = discovered.get('rabbitmq_url', rabbitmq_url)
                
                # Salvar na VPS para as próximas vezes
                self.vps.redis_host = redis_host
                self.vps.redis_password = redis_pass
                self.vps.rabbitmq_url = rabbitmq_url
                self.vps.save()
                logger.info("Infraestrutura auto-detectada e salva no banco de dados.")

        redis_host = redis_host or 'redis'
        redis_pass = redis_pass or ''
        rabbitmq_url = rabbitmq_url or 'amqp://guest:guest@rabbitmq:5672/'
        
        subdomain = provedor.subdomain or ""
        base_url = f"https://{subdomain}"

        # Montar a REDIS_URL
        if redis_pass:
            redis_url = f"redis://:{redis_pass}@{redis_host}:6379/0"
        else:
            redis_url = f"redis://{redis_host}:6379/0"

        # Variáveis Fixas (Vem do .env do Superadmin ou Defaults fornecidos)
        supabase_url = os.getenv('SUPABASE_URL', 'https://uousrmdefljusigvncrb.supabase.co')
        supabase_key = os.getenv('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvdXNybWRlZmxqdXNpZ3ZuY3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5ODQyODgsImV4cCI6MjA3NTU2MDI4OH0._DLHRiae-1eVA31SpPl-M36D12HH5G7jmylIRLKyZ_I')
        whatsapp_token = os.getenv('WHATSAPP_SYSTEM_USER_TOKEN', 'EAAKI9ZAACsD0BQVz1PTZAiQqhXwkVapWERoqfyjuZCIFp71w4v7YzzQAOZCw6Rlqk3IPoZCLmKbIFHY5gCnuEtb41z4D1R2KivGliWfu6zSIBvL0UaQ8mdSDDxpBlaCfBFp7uPxnog7uCmZBmL4yenS31Hi7cSTkZBD3olET3DdRZBed1HvJUwDpZCZB8zXEW2U0MKyAZDZD')
        whatsapp_verify = os.getenv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'niochat_webhook_verify_token')
        fb_secret = os.getenv('FACEBOOK_APP_SECRET', '3436ab37c90d49673af2865a9d995102')
        sentry_dsn = os.getenv('SENTRY_DSN', 'https://63ab1fa0b722f15ce12d2eabe231cc9a@o4510794514366464.ingest.de.sentry.io/4510794516136016')

        env_vars = [
            {"name": "ENVIRONMENT", "value": "production"},
            {"name": "DEBUG", "value": "False"},
            {"name": "SUBDOMAIN", "value": subdomain},
            {"name": "SECRET_KEY", "value": secret_key},
            
            # Banco de Dados
            {"name": "POSTGRES_DB", "value": db_name},
            {"name": "POSTGRES_USER", "value": db_user},
            {"name": "POSTGRES_PASSWORD", "value": db_pass},
            {"name": "DATABASE_URL", "value": database_url},
            
            # Redis
            {"name": "REDIS_HOST", "value": redis_host},
            {"name": "REDIS_PASSWORD", "value": redis_pass or 'E0sJT3wAYFuahovmHkxgy'},
            {"name": "REDIS_URL", "value": f"redis://:{redis_pass or 'E0sJT3wAYFuahovmHkxgy'}@{redis_host}:6379/0"},
            {"name": "REDIS_PORT", "value": "6379"},
            {"name": "REDIS_DB", "value": "0"},
            {"name": "REDIS_AI_DB", "value": "1"},
            {"name": "REDIS_CONVERSATION_DB", "value": "2"},
            {"name": "REDIS_CACHE_DB", "value": "3"},
            {"name": "REDIS_CONNECTION_POOL_SIZE", "value": "20"},
            {"name": "REDIS_SOCKET_TIMEOUT", "value": "10"},
            {"name": "REDIS_SOCKET_CONNECT_TIMEOUT", "value": "10"},
            {"name": "REDIS_RETRY_ON_TIMEOUT", "value": "True"},
            {"name": "REDIS_HEALTH_CHECK_INTERVAL", "value": "30"},
            
            # Supabase
            {"name": "SUPABASE_URL", "value": supabase_url},
            {"name": "SUPABASE_ANON_KEY", "value": supabase_key},
            {"name": "SUPABASE_AUDIT_TABLE", "value": "auditoria"},
            {"name": "SUPABASE_MESSAGES_TABLE", "value": "mensagens"},
            {"name": "SUPABASE_CSAT_TABLE", "value": "csat_feedback"},
            {"name": "SUPABASE_CONTACTS_TABLE", "value": "contacts"},
            {"name": "SUPABASE_CONVERSATIONS_TABLE", "value": "conversations"},
            
            # RabbitMQ / Dramatiq
            {"name": "DRAMATIQ_BROKER_URL", "value": rabbitmq_url},
            
            # WhatsApp / Facebook
            {"name": "WHATSAPP_SYSTEM_USER_TOKEN", "value": whatsapp_token},
            {"name": "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "value": whatsapp_verify},
            {"name": "FACEBOOK_APP_SECRET", "value": fb_secret},
            
            # Sentry
            {"name": "SENTRY_DSN", "value": sentry_dsn},
            {"name": "SENTRY_TEST_KEY", "value": "teste-sentry-niochat"},
            
            # Frontend / CORS
            {"name": "VITE_ENV", "value": "production"},
            {"name": "VITE_API_URL", "value": base_url},
            {"name": "VITE_SUPABASE_URL", "value": supabase_url},
            {"name": "VITE_SUPABASE_ANON_KEY", "value": supabase_key},

            # Integração com Superadmin (Centralização de Webhooks)
            {"name": "SUPERADMIN_API_URL", "value": os.getenv('SUPERADMIN_API_URL', 'https://api.niohub.com.br')},
            {"name": "SUPERADMIN_PROVEDOR_ID", "value": str(provedor.id)},
            {"name": "ADMIN_WEBHOOK_SECRET", "value": os.getenv('ADMIN_WEBHOOK_SECRET', '') or (SystemConfig.objects.first().payload.get('ADMIN_WEBHOOK_SECRET', '') if SystemConfig.objects.first() and SystemConfig.objects.first().payload else '')},
            
            # Primeiro Usuário Administrador
            # Tenta buscar o User vinculado; se não houver, usa dados do próprio Provedor como fallback
            {"name": "INITIAL_ADMIN_USERNAME", "value": self._resolve_initial_admin_username(provedor, slug)},
            {"name": "INITIAL_ADMIN_EMAIL", "value": self._resolve_initial_admin_email(provedor, slug)},
            {"name": "INITIAL_ADMIN_PASSWORD", "value": "NioChat@2024"}, # Senha padrão temporária
            
            {"name": "ALLOWED_HOSTS", "value": f"127.0.0.1,localhost,api.niohub.com.br,chat.niohub.com.br,{subdomain}"},
            {"name": "CORS_ALLOWED_ORIGINS", "value": f"https://chat.niohub.com.br,https://api.niohub.com.br,https://docs.niohub.com.br,{base_url}"},
            {"name": "CSRF_TRUSTED_ORIGINS", "value": f"https://chat.niohub.com.br,https://api.niohub.com.br,https://docs.niohub.com.br,{base_url}"},
            
            # Security
            {"name": "SECURE_CONTENT_TYPE_NOSNIFF", "value": "True"},
            {"name": "SECURE_BROWSER_XSS_FILTER", "value": "True"},
            {"name": "SECURE_SSL_REDIRECT", "value": "False"},
            {"name": "SESSION_COOKIE_SECURE", "value": "False"},
            {"name": "CSRF_COOKIE_SECURE", "value": "False"},
        ]
        
        return env_vars

    def _resolve_initial_admin_username(self, provedor, slug):
        """
        Retorna o username do usuário admin inicial do provedor.
        Prioridade:
          1. User vinculado ao provedor no banco do superadmin
          2. Slug do subdomínio (ex: 'provedor1') — sempre preenchido
        """
        linked_user = User.objects.filter(provedor=provedor).first()
        if linked_user and linked_user.username:
            return linked_user.username
        # Fallback: usa o slug do subdomínio como username
        return slug

    def _resolve_initial_admin_email(self, provedor, slug):
        """
        Retorna o email do usuário admin inicial do provedor.
        Prioridade:
          1. Email do User vinculado ao provedor
          2. email_contato do Provedor
          3. email gerado a partir do slug
        """
        linked_user = User.objects.filter(provedor=provedor).first()
        if linked_user and linked_user.email:
            return linked_user.email
        if provedor.email_contato:
            return provedor.email_contato
        # Fallback final: gera email padrão
        return f"{slug}@niohub.com.br"

    def _get_swarm_id(self):
        """
        Busca o Swarm ID consultando a API do Docker Engine através do proxy do Portainer.
        """
        try:
            # Estratégia 1: Consultar /info do Docker Engine via proxy do Portainer
            docker_info_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/info"
            res_info = requests.get(docker_info_url, headers=self.headers, timeout=10, verify=False)
            
            if res_info.status_code == 200:
                data = res_info.json()
                # No Docker Info, o Swarm ID fica em Swarm -> Cluster -> ID
                swarm_id = data.get('Swarm', {}).get('Cluster', {}).get('ID')
                
                if swarm_id:
                    logger.info(f"SwarmID detectado via Docker Info: {swarm_id}")
                    return swarm_id
                else:
                    logger.error(f"Docker Info retornou sucesso, mas sem Swarm Cluster ID. O nó é um Swarm Manager?")
            else:
                logger.error(f"Erro ao acessar Docker Info ({res_info.status_code}): {res_info.text}")
                
            # Estratégia 2: Fallback para a rota /api/swarm do Portainer (se disponível)
            swarm_url = f"{self.api_url}/api/swarm?endpointId={self.endpoint_id}"
            res_swarm = requests.get(swarm_url, headers=self.headers, timeout=10, verify=False)
            if res_swarm.status_code == 200:
                swarm_id = res_swarm.json().get('ID')
                if swarm_id:
                    logger.info(f"SwarmID detectado via /api/swarm: {swarm_id}")
                    return swarm_id

        except Exception as e:
            logger.warning(f"Não foi possível obter SwarmID: {e}")
            
        logger.error("Falha ao detectar SwarmID em todas as tentativas.")
        return ""

    def _discover_infrastructure(self):
        """
        Tenta descobrir as credenciais de Redis e RabbitMQ vasculhando as stacks do Portainer.
        """
        import json
        discovered = {}
        try:
            # 1. Listar todas as stacks para achar os namespaces
            list_url = f"{self.api_url}/api/stacks"
            res = requests.get(list_url, headers=self.headers, timeout=10, verify=False)
            if res.status_code != 200:
                return discovered
                
            stacks = res.json()
            
            # 2. Procurar RabbitMQ
            rb_stack = next((s for s in stacks if 'rabbitmq' in s.get('Name', '').lower()), None)
            if rb_stack:
                namespace = rb_stack.get('Name')
                # Buscar container desse namespace
                c_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/containers/json"
                params = {"filters": json.dumps({"label": [f"com.docker.stack.namespace={namespace}"]})}
                res_c = requests.get(c_url, params=params, headers=self.headers, timeout=10, verify=False)
                
                if res_c.status_code == 200 and res_c.json():
                    c_id = res_c.json()[0]['Id']
                    # Inspecionar container
                    inspect_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/containers/{c_id}/json"
                    res_i = requests.get(inspect_url, headers=self.headers, timeout=10, verify=False)
                    if res_i.status_code == 200:
                        env = res_i.json().get('Config', {}).get('Env', [])
                        user = next((e.split('=')[1] for e in env if 'RABBITMQ_DEFAULT_USER' in e), 'admin')
                        pwd = next((e.split('=')[1] for e in env if 'RABBITMQ_DEFAULT_PASS' in e), '')
                        discovered['rabbitmq_url'] = f"amqp://{user}:{pwd}@rabbitmq:5672/"
                        logger.info(f"RabbitMQ auto-detectado: {namespace}")

            # 3. Procurar Redis
            # Tenta nomes comuns: redis, redisinsight, cache
            rd_stack = next((s for s in stacks if any(n in s.get('Name', '').lower() for n in ['redis', 'cache'])), None)
            if rd_stack:
                namespace = rd_stack.get('Name')
                c_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/containers/json"
                params = {"filters": json.dumps({"label": [f"com.docker.stack.namespace={namespace}"]})}
                res_c = requests.get(c_url, params=params, headers=self.headers, timeout=10, verify=False)
                
                if res_c.status_code == 200 and res_c.json():
                    # Tenta achar o container que chama 'redis' ou o primeiro
                    containers = res_c.json()
                    redis_c = next((c for c in containers if 'redis' in c.get('Names', [''])[0].lower()), containers[0])
                    c_id = redis_c['Id']
                    
                    inspect_url = f"{self.api_url}/api/endpoints/{self.endpoint_id}/docker/containers/{c_id}/json"
                    res_i = requests.get(inspect_url, headers=self.headers, timeout=10, verify=False)
                    if res_i.status_code == 200:
                        env = res_i.json().get('Config', {}).get('Env', [])
                        pwd = next((e.split('=')[1] for e in env if 'REDIS_PASSWORD' in e or 'REDIS_PASS' in e), '')
                        discovered['redis_host'] = 'redis' # Nome padrão do serviço na rede Nionet
                        discovered['redis_password'] = pwd
                        logger.info(f"Redis auto-detectado: {namespace}")
            
            return discovered
        except Exception as e:
            logger.error(f"Erro na auto-descoberta de infra: {e}")
            return discovered

    def _ensure_registry(self):
        """
        Verifica se a Registry do GHCR (GitHub) está configurada no Portainer.
        Se não estiver, cria automaticamente.
        """
        try:
            # 1. Tentar buscar credenciais dinâmicas do Banco de Dados
            from super_core.models import SystemConfig
            import os
            
            config = SystemConfig.objects.first()
            
            # Fallbacks (Env)
            username = os.getenv('GITHUB_USERNAME', '')
            password = os.getenv('GHCR_TOKEN', '')

            if config and config.payload:
                username = config.payload.get('github_username', username)
                password = config.payload.get('github_pat', password)

            # 2. Listar Registries no Portainer
            reg_url = f"{self.api_url}/api/registries"
            res = requests.get(reg_url, headers=self.headers, timeout=10, verify=False)
            if res.status_code != 200:
                logger.error(f"Erro ao listar registries: {res.text}")
                return

            registries = res.json()
            # Procurar por ghcr.io
            gh_reg = next((r for r in registries if r.get('URL') == 'ghcr.io'), None)

            if not gh_reg:
                logger.info(f"Configurando Registry do GitHub ({username}) automaticamente...")
                # 3. Criar Registry
                payload = {
                    "Name": "GitHub GHCR",
                    "Type": 3, # Custom Registry (conforme log do usuário)
                    "URL": "ghcr.io",
                    "Authentication": True,
                    "Username": username,
                    "Password": password
                }
                res_create = requests.post(reg_url, json=payload, headers=self.headers, timeout=10, verify=False)
                if res_create.status_code in [200, 201]:
                    logger.info("Registry do GitHub configurada com sucesso!")
                else:
                    logger.error(f"Falha ao criar Registry no Portainer: {res_create.text}")
            else:
                # Opcional: Atualizar a senha se ela mudou no banco? 
                # Por enquanto apenas logamos que já existe.
                logger.debug("Registry do GitHub já está configurada.")
        except Exception as e:
            logger.error(f"Erro ao garantir Registry no Portainer: {e}")
