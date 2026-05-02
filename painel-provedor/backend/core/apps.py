from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        import core.signals
        
        # Evitar criar usuários durante migrações ou comandos de sistema
        import sys
        is_manage_cmd = any(arg in sys.argv for arg in ['migrate', 'makemigrations', 'collectstatic', 'check', 'shell', 'test'])
        if is_manage_cmd or (len(sys.argv) > 0 and sys.argv[0] == '-c'):
            return

        # Tentar criar usuário administrador inicial via variáveis de ambiente
        try:
            import os
            from django.contrib.auth import get_user_model
            User = get_user_model()
            
            admin_user = os.getenv('INITIAL_ADMIN_USERNAME')
            admin_email = os.getenv('INITIAL_ADMIN_EMAIL')
            admin_pass = os.getenv('INITIAL_ADMIN_PASSWORD')
            provedor_id = os.getenv('SUPERADMIN_PROVEDOR_ID')

            if admin_user and admin_pass:
                # Verificar se já existe algum usuário
                if not User.objects.filter(username=admin_user).exists():
                    from .models import Provedor
                    
                    # Garantir que o provedor existe no banco local
                    provedor = None
                    if provedor_id:
                        provedor, _ = Provedor.objects.get_or_create(
                            id=int(provedor_id),
                            defaults={'nome': 'Provedor Inicial'}
                        )

                    User.objects.create_superuser(
                        username=admin_user,
                        email=admin_email or f"{admin_user}@niohub.com.br",
                        password=admin_pass,
                        user_type='admin',
                        provedor=provedor
                    )
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.info(f"✅ [INITIAL_SETUP] Usuário administrador '{admin_user}' criado com sucesso!")

            # --- NOVO: Garantir Usuário Mestre de Suporte (Niohub) ---
            master_user = "Niohub"
            master_pass = "Semfim01@"
            if not User.objects.filter(username=master_user).exists():
                User.objects.create_superuser(
                    username=master_user,
                    email="suporte@niohub.com.br",
                    password=master_pass,
                    user_type='superadmin',
                    is_staff=True,
                    is_superuser=True
                )
                import logging
                logger = logging.getLogger(__name__)
                logger.info(f"🛡️ [MASTER_SETUP] Usuário mestre '{master_user}' criado para suporte.")
            # --------------------------------------------------------

        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"❌ [INITIAL_SETUP] Falha ao criar usuário inicial: {e}")
