#!/bin/bash

echo "🚀 Iniciando Nio Chat - Desenvolvimento Local"
echo "=============================================="

# Verificar se o ambiente virtual existe
if [ ! -d "venv" ]; then
    echo "📦 Criando ambiente virtual..."
    python3 -m venv venv
fi

# Ativar ambiente virtual
echo "🔧 Ativando ambiente virtual..."
source venv/bin/activate

# Instalar dependências Python
echo "📥 Instalando dependências Python..."
pip install -r requirements.txt

# Verificar se o PostgreSQL está rodando
echo "🗄️ Verificando PostgreSQL..."
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "❌ PostgreSQL não está rodando!"
    echo "💡 Execute: sudo systemctl start postgresql"
    exit 1
fi

# Verificar se o Redis está rodando
# echo "🔴 Verificando Redis..."
# if ! redis-cli ping > /dev/null 2>&1; then
#     echo "❌ Redis não está rodando!"
#     echo "💡 Execute: sudo systemctl start redis"
#     exit 1
# fi

# Executar migrações
echo "🔄 Executando migrações..."
cd backend
python manage.py migrate
python manage.py collectstatic --noinput

# Verificar se existe superusuário
echo "👤 Verificando superusuário..."
if ! python manage.py shell -c "from django.contrib.auth.models import User; print('Superusuário existe' if User.objects.filter(is_superuser=True).exists() else 'Criar superusuário')" 2>/dev/null | grep -q "Superusuário existe"; then
    echo "⚠️ Nenhum superusuário encontrado!"
    echo "💡 Execute: python manage.py createsuperuser"
fi

# Instalar dependências do frontend
echo "📦 Instalando dependências do frontend..."
cd ../frontend/frontend
if ! command -v pnpm &> /dev/null; then
    echo "📦 Instalando pnpm..."
    npm install -g pnpm
fi
pnpm install

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "🚀 Para iniciar o desenvolvimento:"
echo ""
echo "Terminal 1 - Backend Django:"
echo "  cd backend"
echo "  python manage.py runserver 0.0.0.0:8000"
echo ""
echo "Terminal 2 - Frontend React:"
echo "  cd frontend/frontend"
echo "  pnpm dev"
echo ""
echo "🌐 Acesse:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  Admin:    http://localhost:8000/admin"
echo "" 