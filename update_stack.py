"""
Atualiza uma stack de provedor no Portainer com o compose local (painel-provedor).

Uso (PowerShell):
  $env:PORTAINER_API_KEY = "ptr_..."
  python update_stack.py

Variáveis opcionais:
  PORTAINER_URL     (default: https://portainer-vps1.niohub.com.br)
  STACK_NAME        (default: niohub-teste)
  PROVIDER_IMAGE_TAG (default: stable; use beta-prov para canal beta)
  GITHUB_USERNAME   (ex.: juniorssilvaa) — juntamente com GHCR_TOKEN regista o GHCR no Portainer
  GHCR_TOKEN        PAT com read:packages (ou o mesmo do CI); sem isto, pacotes privados no GHCR
                      dão "No such image" no Swarm até haver login no nó ou registry no Portainer.

Se continuar "No such image" com tag stable:
  - Torne o pacote público em GitHub → Packages → niohub_chat-backend → Package settings, ou
  - Em CADA nó Swarm: docker login ghcr.io -u USER --password-stdin < GHCR_TOKEN
"""
import os
import re
import sys
import warnings

import requests

warnings.filterwarnings("ignore")

PORTAINER_URL = os.environ.get(
    "PORTAINER_URL", "https://portainer-vps1.niohub.com.br"
).rstrip("/")
API_KEY = os.environ.get("PORTAINER_API_KEY", "")
STACK_NAME = os.environ.get("STACK_NAME", "niohub-teste")
PROVIDER_IMAGE_TAG = os.environ.get("PROVIDER_IMAGE_TAG", "stable")
COMPOSE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "painel-provedor",
    "docker-compose.yml",
)


def prepare_compose(raw: str) -> str:
    """Alinha com o deploy Swarm multi-tenant (sem porta 5432 no host, sem aliases)."""
    content = raw
    content = re.sub(r"^\s*container_name:.*$", "", content, flags=re.MULTILINE)
    content = re.sub(r"^\s*aliases:.*$", "", content, flags=re.MULTILINE)
    content = re.sub(r"^\s*-\s*niochat_postgres.*$", "", content, flags=re.MULTILINE)
    content = re.sub(
        r'^\s*ports:.*?\n\s*-\s*"5432:5432".*?\n',
        "\n",
        content,
        flags=re.DOTALL | re.MULTILINE,
    )
    content = content.replace("${PROVIDER_IMAGE_TAG:-stable}", PROVIDER_IMAGE_TAG)
    return content


def ensure_ghcr_registry(portainer_url: str, headers: dict) -> None:
    """Regista ghcr.io no Portainer se GITHUB_USERNAME + GHCR_TOKEN existirem."""
    gh_user = os.environ.get("GITHUB_USERNAME", "").strip()
    gh_token = os.environ.get("GHCR_TOKEN", "").strip()
    if not gh_token or not gh_user:
        print(
            "\n   Aviso: sem GITHUB_USERNAME+GHCR_TOKEN não registo o GHCR no Portainer.\n"
            "   Pacotes privados no GitHub → pulls no Swarm podem falhar com 'No such image'."
        )
        return

    reg_url = f"{portainer_url}/api/registries"
    res = requests.get(reg_url, headers=headers, verify=False, timeout=15)
    if res.status_code != 200:
        print(f"   Aviso: não listei registries ({res.status_code}): {res.text[:200]}")
        return

    registries = res.json()
    if any(r.get("URL") == "ghcr.io" for r in registries):
        print("   Registry ghcr.io já existe no Portainer.")
        return

    payload = {
        "Name": "GitHub GHCR",
        "Type": 3,
        "URL": "ghcr.io",
        "Authentication": True,
        "Username": gh_user,
        "Password": gh_token,
    }
    res_c = requests.post(reg_url, json=payload, headers=headers, verify=False, timeout=15)
    if res_c.status_code in (200, 201):
        print("   Registry ghcr.io criado no Portainer com sucesso.")
    else:
        print(f"   Aviso: falha ao criar registry ghcr.io ({res_c.status_code}): {res_c.text[:300]}")


def main() -> int:
    if not API_KEY:
        print(
            "ERRO: defina PORTAINER_API_KEY no ambiente (não commite o token no repositório)."
        )
        return 1

    headers = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

    print("1. Buscando stacks...")
    res = requests.get(f"{PORTAINER_URL}/api/stacks", headers=headers, verify=False, timeout=30)
    if res.status_code != 200:
        print(f"ERRO ao listar stacks ({res.status_code}): {res.text[:400]}")
        return 1

    stacks = res.json()
    if not isinstance(stacks, list):
        print(f"ERRO: resposta inesperada: {type(stacks)}")
        return 1

    for s in stacks:
        print(f"   Stack: {s['Name']} (ID: {s['Id']}, EndpointId: {s['EndpointId']})")

    target = next((s for s in stacks if s["Name"] == STACK_NAME), None)
    if not target:
        print(f"ERRO: Stack '{STACK_NAME}' não encontrada.")
        return 1

    stack_id = target["Id"]
    endpoint_id = target["EndpointId"]
    print(f"\n2. Stack: {STACK_NAME}  ID={stack_id}  EndpointId={endpoint_id}")

    if not os.path.isfile(COMPOSE_PATH):
        print(f"ERRO: Compose não encontrado: {COMPOSE_PATH}")
        return 1

    print(f"3. Lendo {COMPOSE_PATH} ...")
    with open(COMPOSE_PATH, encoding="utf-8") as f:
        raw = f.read()
    new_compose = prepare_compose(raw)
    print(f"   Compose preparado ({len(new_compose)} caracteres), tag imagem: {PROVIDER_IMAGE_TAG}")

    print("\n4. Imagens:")
    for line in new_compose.split("\n"):
        if "image:" in line and "ghcr.io" in line:
            print(f"   {line.strip()}")

    env_vars = target.get("Env") or []
    print(f"\n5. Mantendo {len(env_vars)} variáveis de ambiente da stack no Portainer.")

    print("\n5b. Registry GHCR (opcional, evita pull anónimo falhar)...")
    ensure_ghcr_registry(PORTAINER_URL, headers)

    print("\n6. Atualizando stack (pull + prune)...")
    update_url = (
        f"{PORTAINER_URL}/api/stacks/{stack_id}"
        f"?endpointId={endpoint_id}&pullImage=true"
    )
    payload = {
        "stackFileContent": new_compose,
        "env": env_vars,
        "prune": True,
        "pullImage": True,
    }
    res_update = requests.put(
        update_url, json=payload, headers=headers, verify=False, timeout=120
    )

    if res_update.status_code == 200:
        print("   [OK] Stack atualizada.")
        return 0

    print(f"   [ERRO] ({res_update.status_code}): {res_update.text[:800]}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
