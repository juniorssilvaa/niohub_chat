import requests
import logging


class SGPClient:
    def __init__(self, base_url, token, app_name):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.app_name = app_name
        self.logger = logging.getLogger(__name__)

    # ==========================================================
    # HEADERS PADRÃO (APENAS PARA ENDPOINTS QUE ACEITAM HEADER)
    # ==========================================================
    def _headers(self, include_content_type=True):
        headers = {}
        if include_content_type:
            headers['Content-Type'] = 'application/json'
        return headers

    # ==========================================================
    # CLIENTES
    # ==========================================================
    def listar_clientes(self):
        return requests.get(
            f'{self.base_url}/api/ura/clientes/',
            headers=self._headers(),
            timeout=30
        ).json()

    def consultar_cliente(self, cpf):
        data = {
            'token': self.token,
            'app': self.app_name,
            'cpfcnpj': str(cpf)
        }
        return requests.post(
            f'{self.base_url}/api/ura/consultacliente/',
            data=data,
            timeout=30
        ).json()

    # ==========================================================
    # ACESSO / CONTRATO
    # ==========================================================
    def verifica_acesso(self, contrato):
        data = {
            'token': self.token,
            'app': self.app_name,
            'contrato': str(contrato)
        }
        return requests.post(
            f'{self.base_url}/api/ura/verificaacesso/',
            data=data,
            timeout=30
        ).json()

    def listar_contratos(self, cliente_id):
        return requests.post(
            f'{self.base_url}/api/ura/listacontrato/',
            json={'cliente_id': cliente_id},
            headers=self._headers(),
            timeout=30
        ).json()

    # ==========================================================
    # LIBERAÇÃO POR CONFIANÇA
    # ==========================================================
    def liberar_por_confianca(self, contrato, cpf_cnpj=None, conteudo=None):
        data = {
            'token': self.token,
            'app': self.app_name,
            'contrato': str(contrato),
            'conteudolimpo': 1
        }

        if cpf_cnpj:
            cpf_cnpj_limpo = (
                str(cpf_cnpj)
                .replace('.', '')
                .replace('-', '')
                .replace('/', '')
            )
            data['cpfCnpj'] = cpf_cnpj_limpo
        
        # Adicionar conteúdo se fornecido (o que o cliente disse, ex: "vou paga amanhã")
        # Se não fornecido, usar "Liberação Via NioChat" como padrão
        if conteudo:
            data['conteudo'] = str(conteudo).strip()
        else:
            data['conteudo'] = "Liberação Via NioChat"

        return requests.post(
            f'{self.base_url}/api/ura/liberacaopromessa/',
            data=data,
            timeout=30
        ).json()

    # ==========================================================
    # CHAMADO TÉCNICO (CORRIGIDO DEFINITIVO)
    # ==========================================================
    def criar_chamado(self, contrato, conteudo, ocorrenciatipo=1):
        """
        Criar chamado técnico no SGP via API URA

        Endpoint:
            POST /api/ura/chamado/

        Regras IMPORTANTES:
        - NÃO enviar Authorization header
        - NÃO enviar App header
        - NÃO enviar Content-Type manualmente
        - Enviar TUDO via form-data (data=)
        """

        url = f'{self.base_url}/api/ura/chamado/'

        data = {
            'token': self.token,
            'app': self.app_name,
            'contrato': str(contrato),
            'conteudo': conteudo,
            'ocorrenciatipo': str(ocorrenciatipo),
            'conteudolimpo': 1
        }

        self.logger.info(
            f"[SGP] Criando chamado | Contrato={contrato} | Tipo={ocorrenciatipo}"
        )
        self.logger.info(
            f"[SGP] Conteúdo do chamado: {conteudo[:200]}"
        )

        try:
            response = requests.post(
                url,
                data=data,
                timeout=10
            )

            self.logger.info(
                f"[SGP] HTTP {response.status_code} | Response: {response.text}"
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Erro HTTP {response.status_code}",
                    "raw": response.text
                }

            try:
                res_json = response.json()
            except ValueError:
                return {
                    "success": False,
                    "error": "Resposta inválida do SGP",
                    "raw": response.text
                }

            if res_json.get("status") == 1:
                return {
                    "success": True,
                    "protocolo": res_json.get("protocolo"),
                    "chamado_id": res_json.get("id"),
                    "raw": res_json
                }

            return {
                "success": False,
                "raw": res_json
            }

        except requests.exceptions.Timeout:
            return {
                "success": False,
                "error": "Timeout na comunicação com o SGP"
            }
        except requests.exceptions.ConnectionError as e:
            return {
                "success": False,
                "error": f"Erro de conexão com o SGP: {str(e)}"
            }
        except Exception as e:
            self.logger.exception("[SGP] Erro inesperado ao criar chamado")
            return {
                "success": False,
                "error": str(e)
            }

    # ==========================================================
    # FATURA / PAGAMENTOS
    # ==========================================================
    def segunda_via_fatura(self, cpf_cnpj):
        data = {
            'token': self.token,
            'app': self.app_name,
            'cpfcnpj': str(cpf_cnpj)
        }
        return requests.post(
            f'{self.base_url}/api/ura/fatura2via/',
            data=data,
            timeout=30
        ).json()

    def gerar_pix(self, fatura):
        return requests.get(
            f'{self.base_url}/api/ura/pagamento/pix/{fatura}',
            headers=self._headers(),
            timeout=30
        ).json()

    def listar_titulos(self, cpf_cnpj, limit=250):
        """
        Lista títulos (faturas) do cliente via endpoint /api/ura/titulos/
        
        Args:
            cpf_cnpj: CPF ou CNPJ do cliente
            limit: Limite de resultados (padrão: 250, máximo: 250)
            
        Returns:
            Resposta JSON com paginacao e titulos
        """
        data = {
            'token': self.token,
            'app': self.app_name,
            'cpfcnpj': str(cpf_cnpj),
            'limit': min(limit, 250)  # Máximo permitido é 250
        }
        return requests.post(
            f'{self.base_url}/api/ura/titulos/',
            data=data,
            timeout=30
        ).json()

    # ==========================================================
    # MANUTENÇÕES
    # ==========================================================
    def listar_manutencoes(self, cpf):
        return requests.post(
            f'{self.base_url}/api/ura/manutencao/list/',
            json={'cpf': cpf},
            headers=self._headers(),
            timeout=30
        ).json()
