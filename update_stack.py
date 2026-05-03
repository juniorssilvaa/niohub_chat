"""
Script para atualizar a stack do provedor no Portainer via API.
Corrige os nomes das imagens de niochat-* para niohub_chat-*.
"""
import requests
import json
import warnings
warnings.filterwarnings('ignore')

PORTAINER_URL = "https://vps1.niohub.com.br"
API_KEY = "ptr_ZC/n1xnGuIMSwa3u1l9e9wFxhGAwnGx/Q8/1Qvsuca8="
STACK_NAME = "niohub-e-tech"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# 1. Listar stacks
print("1. Buscando stacks...")
res = requests.get(f"{PORTAINER_URL}/api/stacks", headers=headers, verify=False)
stacks = res.json()

for s in stacks:
    print(f"   Stack: {s['Name']} (ID: {s['Id']}, EndpointId: {s['EndpointId']})")

# 2. Encontrar a stack do provedor
target = next((s for s in stacks if s['Name'] == STACK_NAME), None)
if not target:
    print(f"ERRO: Stack '{STACK_NAME}' nao encontrada!")
    exit(1)

stack_id = target['Id']
endpoint_id = target['EndpointId']
print(f"\n2. Stack encontrada: ID={stack_id}, EndpointId={endpoint_id}")

# 3. Buscar o compose atual da stack
print("3. Buscando compose atual...")
res_file = requests.get(f"{PORTAINER_URL}/api/stacks/{stack_id}/file", headers=headers, verify=False)
compose_data = res_file.json()
compose_content = compose_data.get('StackFileContent', '')

print(f"   Compose tem {len(compose_content)} caracteres")

# Mostrar imagens atuais
for line in compose_content.split('\n'):
    if 'image:' in line:
        print(f"   ATUAL: {line.strip()}")

# 4. Substituir nomes das imagens
new_compose = compose_content.replace(
    'ghcr.io/juniorssilvaa/niochat-backend:', 
    'ghcr.io/juniorssilvaa/niohub_chat-backend:'
)
new_compose = new_compose.replace(
    'ghcr.io/juniorssilvaa/niochat-frontend:', 
    'ghcr.io/juniorssilvaa/niohub_chat-frontend:'
)

print("\n4. Imagens corrigidas:")
for line in new_compose.split('\n'):
    if 'image:' in line:
        print(f"   NOVO: {line.strip()}")

# 5. Buscar env vars atuais
print("\n5. Buscando env vars atuais...")
env_vars = target.get('Env', [])
print(f"   {len(env_vars)} variaveis de ambiente encontradas")

# 6. Atualizar a stack
print("\n6. Atualizando stack no Portainer...")
update_url = f"{PORTAINER_URL}/api/stacks/{stack_id}?endpointId={endpoint_id}&pullImage=true"

payload = {
    "stackFileContent": new_compose,
    "env": env_vars,
    "prune": True,
    "pullImage": True
}

res_update = requests.put(update_url, json=payload, headers=headers, verify=False, timeout=120)

if res_update.status_code == 200:
    print("   ✅ Stack atualizada com SUCESSO!")
    print("   O Portainer vai baixar as novas imagens e reiniciar os servicos.")
else:
    print(f"   ❌ Erro ({res_update.status_code}): {res_update.text[:500]}")
