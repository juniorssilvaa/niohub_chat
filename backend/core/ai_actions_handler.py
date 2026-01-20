import logging
import json
import re
import asyncio
import random
import time
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime
from django.utils import timezone
from asgiref.sync import sync_to_async, async_to_sync

# Importações necessárias do projeto
from .models import Provedor, AuditLog
from .database_tools import DatabaseTools
from .database_function_definitions import DATABASE_FUNCTION_MAPPING, DATABASE_FUNCTION_TOOLS
from .sgp_client import SGPClient
from .fatura_service import FaturaService
from .redis_memory_service import redis_memory_service
from conversations.closing_service import closing_service
from core.chat_migration_service import chat_migration_service

logger = logging.getLogger(__name__)


def _debug_log(message: str, data: Dict[str, Any], *, location: str, hypothesis_id: str, run_id: str = "run1") -> None:
    try:
        payload = {
            "sessionId": "debug-session",
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        log_path = r"e:\niochat\.cursor\debug.log"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        pass

class AIActionsHandler:
    """
    Sub-agente responsável pela execução de ações e chamadas de funções (Tools).
    Gerencia integrações com SGP, Banco de Dados e outras ferramentas externas.
    """

    def __init__(self, openai_service=None):
        self.openai_service = openai_service

    def _is_valid_cpf_cnpj(self, cpf_cnpj: str) -> bool:
        """Valida se a string é um CPF ou CNPJ válido"""
        if not cpf_cnpj:
            return False
        clean = re.sub(r'[^\d]', '', str(cpf_cnpj))
        if len(clean) not in [11, 14]:
            return False
        return clean.isdigit()

    def _verificar_horario_atendimento(self, provedor: Provedor) -> Dict[str, Any]:
        """Verifica se está dentro do horário de atendimento"""
        if self.openai_service and hasattr(self.openai_service, 'formatter'):
            return self.openai_service.formatter._verificar_horario_atendimento(provedor)
        return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}

    def _formatar_horarios_atendimento(self, horarios: list) -> str:
        """Formata os horários de atendimento no padrão solicitado pelo usuário (sem emojis)"""
        if not horarios or not isinstance(horarios, list): return ""
        
        dias_semana_map = {
            'segunda': 'Segunda-feira', 'terça': 'Terça-feira', 'terca': 'Terça-feira',
            'quarta': 'Quarta-feira', 'quinta': 'Quinta-feira', 'sexta': 'Sexta-feira',
            'sábado': 'Sábado', 'sabado': 'Sábado', 'domingo': 'Domingo'
        }
        
        linhas = ["Nosso horário de atendimento é:\n"]
        
        for d in horarios:
            dia_raw = d.get('dia', '').lower().strip()
            # Remover sufixos se houver e re-adicionar padrão
            dia_base = dia_raw.split('-')[0].split(' ')[0]
            dia_formatado = dias_semana_map.get(dia_base, dia_raw.capitalize())
            
            periodos = d.get('periodos', [])
            if not periodos:
                linhas.append(f"{dia_formatado}: Fechado")
            else:
                p_strings = []
                for p in periodos:
                    inicio = p.get('inicio', '')
                    fim = p.get('fim', '')
                    if inicio and fim:
                        p_strings.append(f"{inicio} às {fim}")
                
                if p_strings:
                    horario_str = " e ".join(p_strings)
                    linhas.append(f"{dia_formatado}: {horario_str}")
                else:
                    linhas.append(f"{dia_formatado}: Fechado")
        
        return "\n".join(linhas)

    def _formatar_contratos_padrao(self, contratos: list, nome_cliente: str) -> str:
        """Formata contratos no padrão WhatsApp"""
        nome = f"*{nome_cliente.upper()}*"
        if len(contratos) == 1:
            c = contratos[0]
            cid = str(c.get('contratoId', ''))
            end_parts = [c.get('endereco_logradouro'), c.get('endereco_numero'), c.get('endereco_bairro'), c.get('endereco_cidade'), c.get('endereco_uf')]
            end = ' '.join(str(p).strip() for p in end_parts if p and str(p).strip().lower() != 'none').upper() or "ENDEREÇO NÃO INFORMADO"
            return f"{nome}, contrato localizado:\n\n1 - Contrato ({cid}): *{end}*\n\nSeus dados estão corretos? Me confirma para continuar."
        else:
            msg = f"{nome}, encontramos mais de um contrato. Escolha o contrato desejado:"
            for idx, c in enumerate(contratos, 1):
                cid = str(c.get('contratoId', ''))
                end_parts = [c.get('endereco_logradouro'), c.get('endereco_numero'), c.get('endereco_bairro'), c.get('endereco_cidade'), c.get('endereco_uf')]
                end = ' '.join(str(p).strip() for p in end_parts if p and str(p).strip().lower() != 'none').upper() or "ENDEREÇO NÃO INFORMADO"
                msg += f"\n\n{idx} - Contrato ({cid}): *{end}*"
            return msg

    def execute_database_function(self, provedor: Provedor, function_name: str, function_args: dict, contexto: dict = None) -> dict:
        """Executa funções de banco de dados (Transferências, etc.) com ISOLAMENTO total"""
        try:
            if not provedor: return {"success": False, "erro": "Provedor não identificado para execução de banco de dados."}

            # Identificadores para memória e isolamento
            conv = contexto.get('conversation') if contexto else None
            conversation_id = conv.id if conv else None
            channel = contexto.get('canal', 'wa') if contexto else 'wa'
            phone = contexto.get('contact', {}).phone if contexto and contexto.get('contact') else (contexto.get('contact_phone', 'unknown') if contexto else 'unknown')

            # Validação forte de tenant
            if conv and conv.inbox and conv.inbox.provedor_id:
                ctx_pid = conv.inbox.provedor_id
                if int(ctx_pid) != int(provedor.id):
                    return {"success": False, "erro": "Isolamento de provedor violado."}

            # Carregar estado para idempotência se disponível
            conversation_state = {}
            if conversation_id:
                conversation_state = redis_memory_service.get_ai_state_sync(provedor.id, conversation_id, channel, phone)

            # Cálculo de hash para idempotência
            args_hash = hashlib.sha256(json.dumps(function_args, sort_keys=True, default=str).encode("utf-8")).hexdigest()

            # Verificação de idempotência
            if (conversation_state.get("last_function") == function_name and 
                conversation_state.get("last_function_args_hash") == args_hash and 
                conversation_state.get("last_function_success") is True):
                logger.info(f"[ACTIONS] Ação {function_name} já executada com sucesso. Retornando cache.")
                return {
                    "success": True, 
                    "cached": True,
                    "mensagem_formatada": conversation_state.get("last_ia_response") or "Certo. Já realizei essa ação para você.",
                    "protocolo": conversation_state.get("protocolo")
                }

            # Ferramentas de banco isoladas por provedor
            db_tools = DatabaseTools(provedor=provedor)
            method_name = DATABASE_FUNCTION_MAPPING.get(function_name)
            if not method_name: return {"success": False, "erro": f"Ação '{function_name}' não mapeada."}
            
            # Garantir conversation_id correto
            if 'conversation_id' in function_args and conversation_id:
                function_args['conversation_id'] = conversation_id
            
            method = getattr(db_tools, method_name)
            
            # Caso especial para encerramento
            if function_name == "encerrar_atendimento":
                if conv:
                    closing_service.request_closing(conv)
                    redis_memory_service.clear_conversation_memory_sync(conv.id, provedor_id=provedor.id, channel=channel, phone=phone)
                    res = {
                        "success": True, 
                        "mensagem_formatada": "Perfeito! Estou encerrando seu atendimento agora conforme solicitado. Se precisar de algo no futuro, é só nos chamar novamente. Tenha um ótimo dia! 👋"
                    }
                else:
                    return {"success": False, "erro": "Conversa não identificada."}
            else:
                res = method(**function_args)

            # Persistir idempotência após sucesso
            if res.get('success') and conversation_id:
                redis_memory_service.update_ai_state_sync(
                    provedor.id, conversation_id,
                    {
                        "last_function": function_name,
                        "last_function_args_hash": args_hash,
                        "last_function_success": True,
                        "protocolo": res.get("protocolo")
                    },
                    channel, phone
                )
            
            return res
        except Exception as e:
            logger.error(f"Erro ao executar ação de banco: {e}", exc_info=True)
            return {"success": False, "erro": str(e)}

    def execute_sgp_function(self, provedor: Provedor, function_name: str, function_args: dict, contexto: dict = None) -> dict:
        """Executa funções do SGP (Consulta, Fatura, Chamado, etc.) com ISOLAMENTO total"""
        try:
            if not provedor: return {"success": False, "erro": "Provedor não identificado."}

            # Identificadores com normalização estrita
            conv = contexto.get('conversation') if contexto else None
            conversation_id = conv.id if conv else None
            channel = redis_memory_service.normalize_channel(contexto.get('canal', 'whatsapp') if contexto else 'whatsapp')
            phone = contexto.get('contact', {}).phone if contexto and contexto.get('contact') else (contexto.get('contact_phone', 'unknown') if contexto else 'unknown')

            # Validação tenant
            if conv and conv.inbox and conv.inbox.provedor_id:
                if int(conv.inbox.provedor_id) != int(provedor.id):
                    return {"success": False, "erro": "Isolamento violado."}

            # Carregar estado
            conversation_state = {}
            if conversation_id:
                conversation_state = redis_memory_service.get_ai_state_sync(provedor.id, conversation_id, channel, phone)

            # Cálculo de hash para idempotência
            args_hash = hashlib.sha256(json.dumps(function_args, sort_keys=True, default=str).encode("utf-8")).hexdigest()

            # Verificação de idempotência específica para SGP (especialmente fatura)
            if function_name == "gerar_fatura_completa" and conversation_state.get("fatura_enviada"):
                return {
                    "success": True, 
                    "cached": True,
                    "mensagem_formatada": "Sua fatura já foi enviada aqui no WhatsApp. Precisa de mais alguma coisa?"
                }

            if (conversation_state.get("last_function") == function_name and 
                conversation_state.get("last_function_args_hash") == args_hash and 
                conversation_state.get("last_function_success") is True):
                return {
                    "success": True, 
                    "cached": True,
                    "mensagem_formatada": conversation_state.get("last_ia_response") or "Já realizei essa consulta para você.",
                    "protocolo": conversation_state.get("protocolo")
                }

            # Integração SGP
            integracao = provedor.integracoes_externas or {}
            sgp_url, sgp_token, sgp_app = integracao.get('sgp_url'), integracao.get('sgp_token'), integracao.get('sgp_app')
            if not all([sgp_url, sgp_token, sgp_app]):
                return {"success": False, "erro": "SGP não configurado."}
            
            sgp = SGPClient(base_url=sgp_url, token=sgp_token, app_name=sgp_app)
            res = {"success": False, "erro": "Ação não reconhecida."}

            if function_name == "consultar_cliente_sgp":
                cpf_cnpj = function_args.get('cpf_cnpj', '').replace('.', '').replace('-', '').replace('/', '')
                
                # Memória de consulta rápida
                if conversation_state.get('cpf_cnpj') == cpf_cnpj and conversation_state.get('servico_plano'):
                    return {"success": True, "cliente_encontrado": True, "nome": conversation_state.get('nome_cliente'), "usando_memoria": True}
                
                sgp_res = sgp.consultar_cliente(cpf_cnpj)
                contratos = [c for c in sgp_res.get('contratos', []) if c.get('contratoStatusDisplay', '').lower() not in ['cancelado', 'cancelada']]
                
                if not contratos:
                    res = {"success": True, "cliente_encontrado": False, "erro": "Nenhum contrato ativo/suspenso encontrado."}
                else:
                    nome = contratos[0].get('razaoSocial', 'Cliente')
                    msg = self._formatar_contratos_padrao(contratos, nome)
                    c = contratos[0]
                    step = "AGUARDANDO_ESCOLHA_CONTRATO" if len(contratos) > 1 else "AGUARDANDO_CONFIRMACAO_CONTRATO"
                    is_suspenso = c.get('contratoStatusDisplay', '').strip().lower() in ['suspenso', 'suspensa']
                    
                    # Se o contrato está suspenso, mudar para o fluxo de suspensão para evitar que o determinístico trave em FATURA
                    actual_flow = 'SUSPENSO' if is_suspenso else 'FATURA'
                    actual_step = 'AGUARDANDO_OPCAO_SUSPENSO' if is_suspenso else step

                    updates = {
                        'cpf_cnpj': cpf_cnpj, 'nome_cliente': nome, 'contrato_id': c.get('contratoId'),
                        'servico_plano': c.get('servico_plano') or c.get('planointernet'),
                        'contrato_status_display': c.get('contratoStatusDisplay'),
                        'motivo_status': c.get('motivo_status'),
                        'is_suspenso': is_suspenso, 'cliente_consultado': True, 
                        'flow': actual_flow, 'step': actual_step,
                        'contratos': contratos if len(contratos) > 1 else None
                    }
                    
                    if conversation_id:
                        redis_memory_service.update_ai_state_sync(provedor.id, conversation_id, updates, channel, phone)
                    
                    res = {
                        "success": True, 
                        "cliente_encontrado": True, 
                        "nome": nome, 
                        "mensagem_formatada": msg, 
                        "is_suspenso": is_suspenso,
                        "contrato_suspenso": is_suspenso,
                        "contrato_status_display": c.get('contratoStatusDisplay'),
                        "motivo_status": c.get('motivo_status')
                    }

            elif function_name == "verificar_acesso_sgp":
                cid = function_args.get('contrato')
                if not cid: return {"success": False, "erro": "Contrato obrigatório."}
                
                if conversation_state.get('is_suspenso'):
                    return {"success": False, "erro": "Contrato suspenso por falta de pagamento.", "contrato_suspenso": True}
                
                sgp_res = sgp.verifica_acesso(cid)
                status = "Online" if (isinstance(sgp_res, list) and len(sgp_res) > 0) or (isinstance(sgp_res, dict) and sgp_res.get('status') == 1) else "Offline"
                msg_status = "sua conexão está normal" if status == "Online" else "não consegui detectar seu equipamento online"
                res = {"success": True, "status_conexao": status, "mensagem_formatada": f"Verifiquei aqui e {msg_status}. Como posso ajudar?"}

            elif function_name == "gerar_fatura_completa":
                cpf = function_args.get('cpf_cnpj', '')
                tipo_pagamento = function_args.get('tipo_pagamento', 'pix')
                if not self._is_valid_cpf_cnpj(cpf): return {"success": False, "erro": "CPF/CNPJ inválido."}
                
                fs = FaturaService()
                dados = fs.buscar_fatura_sgp(provedor, cpf)
                if not dados: return {"success": False, "erro": "Nenhuma fatura em aberto."}
                
                if not phone or phone == 'unknown': return {"success": False, "erro": "Telefone não identificado."}

                envio = fs.enviar_fatura(provedor, phone, dados, conv, tipo_pagamento)
                
                if (isinstance(envio, bool) and envio) or (isinstance(envio, dict) and envio.get('success')):
                    if conversation_id:
                        # Se foi enviado com sucesso, limpar o fluxo de suspensão/fatura
                        redis_memory_service.update_ai_state_sync(provedor.id, conversation_id, {"flow": "NONE", "step": "INICIAL", "fatura_enviada": True}, channel, phone)
                    res = {"success": True, "mensagem": "Fatura enviada com sucesso!"}
                else:
                    res = {"success": False, "erro": "Falha no envio."}

            elif function_name == "criar_chamado_tecnico":
                cid, cont = function_args.get('contrato'), function_args.get('conteudo')
                if not cid or not cont: return {"success": False, "erro": "Dados insuficientes."}
                
                if conversation_state.get('is_suspenso'):
                    return {"success": False, "erro": "Contrato suspenso.", "contrato_suspenso": True}
                
                sgp_res = sgp.criar_chamado(contrato=re.sub(r'[^\d]', '', str(cid)), conteudo=cont, ocorrenciatipo=1)
                if sgp_res.get('success'):
                    protocolo = sgp_res.get('protocolo')
                    if conv:
                        DatabaseTools(provedor=provedor).executar_transferencia_conversa(conv.id, "SUPORTE TÉCNICO", f"Chamado: {protocolo}")
                    res = {"success": True, "protocolo": protocolo, "mensagem_formatada": f"Já abri seu chamado (Protocolo: {protocolo}) e estou te transferindo para o suporte. Só um momento!"}
                else:
                    res = {"success": False, "erro": sgp_res.get('error')}
            
            elif function_name == "liberar_por_confianca":
                cid = function_args.get('contrato')
                cpf_cnpj = function_args.get('cpf_cnpj') or conversation_state.get('cpf_cnpj')
                if not cid: return {"success": False, "erro": "Contrato obrigatório."}
                
                sgp_res = sgp.liberar_por_confianca(contrato=str(cid), cpf_cnpj=cpf_cnpj)
                if sgp_res.get('success') or sgp_res.get('msg', '').lower() in ['liberado', 'sucesso']:
                    if conversation_id:
                        redis_memory_service.update_ai_state_sync(provedor.id, conversation_id, {"flow": "NONE", "step": "INICIAL", "is_suspenso": False}, channel, phone)
                    res = {"success": True, "mensagem_formatada": "Pronto! Realizei o desbloqueio em confiança. Seu acesso voltará em alguns minutos. 😊"}
                else:
                    res = {"success": False, "erro": sgp_res.get('msg') or "Erro no desbloqueio."}

            # Persistir idempotência SGP
            if res.get('success') and conversation_id and function_name != "consultar_cliente_sgp":
                redis_memory_service.update_ai_state_sync(
                    provedor.id, conversation_id,
                    {
                        "last_function": function_name,
                        "last_function_args_hash": args_hash,
                        "last_function_success": True,
                        "protocolo": res.get("protocolo")
                    },
                    channel, phone
                )

            return res
        except Exception as e:
            logger.error(f"Erro crítico em execute_sgp_function: {e}", exc_info=True)
            return {"success": False, "erro": str(e)}

            return {"success": False, "erro": f"Função {function_name} não suportada ou não implementada."}
        except Exception as e:
            logger.error(f"Erro crítico em execute_sgp_function (Provedor {provedor.id}): {e}", exc_info=True)
            return {"success": False, "erro": str(e)}

    def get_sgp_tools(self) -> List[Dict[str, Any]]:
        """Retorna definições das ferramentas"""
        return [
            {"type": "function", "function": {"name": "consultar_cliente_sgp", "description": "Consulta cliente SGP por CPF/CNPJ. Retorna informações do contrato incluindo status (Suspenso/Ativo) e motivo da suspensão. Use SEMPRE quando o cliente relatar problemas de internet para verificar se o contrato está suspenso antes de fazer diagnóstico técnico.", "parameters": {"type": "object", "properties": {"cpf_cnpj": {"type": "string"}}, "required": ["cpf_cnpj"]}}},
            {"type": "function", "function": {"name": "gerar_fatura_completa", "description": "Gera e envia fatura completa para o cliente via WhatsApp. Use quando o cliente pedir fatura, segunda via, boleto ou PIX.", "parameters": {"type": "object", "properties": {"cpf_cnpj": {"type": "string"}, "tipo_pagamento": {"type": "string", "enum": ["pix", "boleto"]}}, "required": ["cpf_cnpj"]}}},
            {"type": "function", "function": {"name": "verificar_acesso_sgp", "description": "Verifica se o acesso à internet do contrato está online ou offline. Use APENAS se o contrato NÃO estiver suspenso. NUNCA use para contrato suspenso.", "parameters": {"type": "object", "properties": {"contrato": {"type": "string"}}, "required": ["contrato"]}}},
            {"type": "function", "function": {"name": "criar_chamado_tecnico", "description": "Cria chamado técnico no SGP. Use APENAS se o contrato NÃO estiver suspenso e após fazer diagnóstico técnico. NUNCA use para contrato suspenso.", "parameters": {"type": "object", "properties": {"contrato": {"type": "string"}, "conteudo": {"type": "string"}}, "required": ["contrato", "conteudo"]}}},
            {"type": "function", "function": {"name": "liberar_por_confianca", "description": "Realiza desbloqueio em confiança do contrato suspenso. Use quando o cliente quiser desbloquear o acesso sem pagar imediatamente. O CPF/CNPJ é opcional e será buscado da memória se não fornecido.", "parameters": {"type": "object", "properties": {"contrato": {"type": "string"}, "cpf_cnpj": {"type": "string", "description": "CPF/CNPJ do cliente (opcional, será buscado da memória se não fornecido)"}}, "required": ["contrato"]}}}
        ]

    def convert_tools_to_gemini(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Converte para formato Gemini"""
        gemini_tools = []
        for t in tools:
            if t.get("type") == "function":
                f = t.get("function", {})
                params = f.get("parameters", {})
                if isinstance(params, dict):
                    params = {k: v for k, v in params.items() if k.lower() not in ['additionalproperties', 'strict']}
                gemini_tools.append({"name": f.get("name"), "description": f.get("description"), "parameters": params})
        return gemini_tools
