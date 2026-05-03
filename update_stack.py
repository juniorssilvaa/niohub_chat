"""
Script para atualizar a stack do provedor no Portainer via API.
Corrige os nomes das imagens de niochat-* para niohub_chat-*.
"""
import requests
import json
import warnings
warnings.filterwarnings('ignore')

PORTAINER_URL = "https://portainer.niohub.com.br"
API_KEY = "ptr_FAQKnE5641BvHtPJ55n9h3Ue4ME1wW2ebABlBhjGCIU="
STACK_NAME = "superadmin"

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

# 3. Ler o arquivo local docker-compose.yml
print("3. Lendo arquivo local superadmin/docker-compose.superadmin.yml...")
with open('superadmin/docker-compose.superadmin.yml', 'r', encoding='utf-8') as f:
    new_compose = f.read()

print(f"   Compose local lido com sucesso ({len(new_compose)} caracteres)")

# 4. Mostrar imagens que serao enviadas
print("\n4. Imagens que serao enviadas:")
for line in new_compose.split('\n'):
    if 'image:' in line:
        print(f"   IMAGE: {line.strip()}")

# 5. Buscar env vars atuais
print("\n5. Buscando env vars atuais...")
env_vars = target.get('Env', []) or []
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
    print("   [OK] Stack atualizada com SUCESSO!")
    print("   O Portainer vai baixar as novas imagens e reiniciar os servicos.")
else:
    print(f"   [ERRO] ({res_update.status_code}): {res_update.text[:500]}")
