import logging
import json
import requests
import re
import uuid
from datetime import datetime, date
from typing import Any, Dict, Optional, List, Tuple
from asgiref.sync import sync_to_async
from .models import ChatbotFlow, Provedor
from .redis_memory_service import redis_memory_service
from integrations.whatsapp_cloud_send import send_via_whatsapp_cloud_api
from conversations.closing_service import closing_service

logger = logging.getLogger(__name__)

def _formatar_endereco(contrato: dict) -> str:
    """Monta o endereço completo a partir de um dict de contrato SGP."""
    campos = [
        contrato.get('endereco_tipo_logradouro', ''),
        contrato.get('endereco_logradouro', ''),
        contrato.get('endereco_numero', ''),
        contrato.get('endereco_complemento', ''),
        contrato.get('endereco_bairro', ''),
        contrato.get('endereco_cidade', ''),
        contrato.get('endereco_uf', ''),
    ]
    # Filtra valores vazios, None, 'None', 'null'
    partes = [str(c).strip() for c in campos if c and str(c).strip().lower() not in ('none', 'null', '')]
    if partes:
        return ' '.join(partes)
    # Fallback: usar popNome se não tiver campos de endereço
    return contrato.get('popNome', '') or 'Endereço não informado'


class ChatbotEngine:
    """
    Motor de execução para fluxos criados no Chatbot Builder.
    Gerencia estados no Redis e executa transições entre nós.
    """

    @staticmethod
    async def process_message(provedor_id: int, conversation_id: int, message_content: str, button_id: Optional[str] = None):
        """
        Processa uma mensagem recebida e avança o fluxo.
        """
        # 1. Obter o fluxo ativo para o provedor
        flow = await ChatbotFlow.objects.filter(provedor_id=provedor_id).order_by('-updated_at').afirst()
        if not flow:
            logger.info(f"[ChatbotEngine] Nenhum fluxo encontrado para provedor {provedor_id}")
            return False, "Nenhum fluxo encontrado"

        nodes = flow.nodes
        edges = flow.edges
        
        logger.info(f"[ChatbotEngine] Processando mensagem para conv {conversation_id}. Flow={flow.id}, Nodes={len(nodes)}")

        # 2. Identificar estado atual (nó atual)
        # Usamos uma chave específica no Redis para o estado do chatbot
        state_key = f"chatbot_state:{provedor_id}:{conversation_id}"
        current_state = await redis_memory_service.get_ai_state(provedor_id, conversation_id, "whatsapp", "unknown")
        logger.info(f"[ChatbotEngine] Processando msg: conv={conversation_id}, content='{message_content}', button={button_id}")
        current_node_id = current_state.get("chatbot_node_id")

        # Salvar última mensagem do usuário no contexto para uso nos nós SGP
        if message_content and message_content.strip():
            flow_context = current_state.get('flow_context', {})
            flow_context['last_user_message'] = message_content.strip()
            # Se parece com CPF (11 dígitos) ou CNPJ (14 dígitos), guardar também como 'cpf'
            digits_only = ''.join(filter(str.isdigit, message_content.strip()))
            if len(digits_only) in [11, 14]:
                flow_context['cpf'] = digits_only
                flow_context['cpfcnpj'] = digits_only
                logger.info(f"[ChatbotEngine] CPF/CNPJ detectado na mensagem e salvo no contexto do fluxo.")
            # Se parece com número de contrato (numérico genérico, mas não CPF/CNPJ)
            if digits_only and len(digits_only) >= 4 and len(digits_only) not in [11, 14]:
                flow_context.setdefault('contrato', digits_only)
            current_state['flow_context'] = flow_context
            current_state['last_user_message'] = message_content.strip()
            await redis_memory_service.update_ai_state(provedor_id, conversation_id, current_state, "whatsapp", "unknown")

        next_node = None

        if current_node_id:
            logger.info(f"[ChatbotEngine] Continuando fluxo da conversa {conversation_id}. Nó atual: {current_node_id}")

            # === SGP: Verifica se está aguardando seleção de contrato ===
            if current_node_id.startswith('sgp_select_'):
                sgp_original_node_id = current_node_id[len('sgp_select_'):]
                flow_context = current_state.get('flow_context', {})
                contratos_pendentes = flow_context.get('contratos_pendentes', [])
                selected_contrato = None

                if button_id and button_id.startswith('sgp_contrato_'):
                    num_sel = button_id[len('sgp_contrato_'):]
                    selected_contrato = next((c for c in contratos_pendentes if str(c.get('contrato', '')) == num_sel), None)
                elif message_content and message_content.strip().isdigit():
                    idx = int(message_content.strip()) - 1
                    if 0 <= idx < len(contratos_pendentes):
                        selected_contrato = contratos_pendentes[idx]

                if selected_contrato:
                    logger.info(f"[ChatbotEngine][SGP] Contrato selecionado: {selected_contrato.get('contrato')}")
                    # Salva o contrato escolhido no contexto
                    flow_context['contrato'] = str(selected_contrato.get('contrato', ''))
                    flow_context['cliente_id'] = str(selected_contrato.get('cliente_id', ''))
                    flow_context['cidade'] = selected_contrato.get('popNome', '') or selected_contrato.get('endereco_cidade', '')
                    flow_context['endereco'] = _formatar_endereco(selected_contrato)
                    flow_context['status_contrato'] = str(selected_contrato.get('contratoStatus', ''))
                    flow_context.pop('contratos_pendentes', None)
                    current_state['flow_context'] = flow_context
                    current_state['chatbot_node_id'] = sgp_original_node_id
                    await redis_memory_service.update_ai_state(provedor_id, conversation_id, current_state, "whatsapp", "unknown")
                    # Avançar para o próximo nó após o SGP
                    edge = next((e for e in edges if e.get('source') == sgp_original_node_id), None)
                    if edge:
                        nxt = next((n for n in nodes if n.get('id') == edge.get('target')), None)
                        if nxt:
                            await ChatbotEngine.execute_node(provedor_id, conversation_id, nxt, flow)
                            return True, "Contrato selecionado, fluxo avançado"
                    logger.warning(f"[ChatbotEngine][SGP] Nenhum nó após o SGP após seleção de contrato.")
                    return True, "Contrato selecionado"
                else:
                    logger.warning(f"[ChatbotEngine][SGP] Seleção de contrato inválida: button_id={button_id}, msg={message_content}")
                    from conversations.models import Conversation
                    conv = await sync_to_async(Conversation.objects.select_related('inbox', 'inbox__provedor', 'contact').get)(id=conversation_id)
                    await ChatbotEngine.send_message_agnostic(conv=conv, text="Por favor, selecione uma das opções listadas acima.")
                    return True, "Aguardando seleção de contrato"
            # === FIM da seleção de contrato ===

            # Tentar encontrar o próximo nó
            # 1. Se for clique em botão (button_id), tentar achar aresta que combine com o handle
            if button_id:
                logger.info(f"[ChatbotEngine] Recebido button_id: {button_id}. Buscando aresta com sourceHandle correspondente.")
                # O builder agora salva o ID do botão/item no campo sourceHandle do edge
                edge = next((e for e in edges if e.get('source') == current_node_id and e.get('sourceHandle') == button_id), None)
                
                if edge:
                    logger.info(f"[ChatbotEngine] Aresta encontrada pelo handle: {edge.get('id')} -> Target: {edge.get('target')}")
                else:
                    edges_from_current = [e for e in edges if e.get('source') == current_node_id]
                    handles = [e.get('sourceHandle') for e in edges_from_current]
                    logger.warning(f"[ChatbotEngine) SEM MATCH de handle para {button_id}. Handles no nó {current_node_id}: {handles}")
                    
                    # Fallback Inteligente:
                    # 1. Tentar aresta sem handle (default)
                    # 2. Se houver apenas uma aresta, usamos ela (compatibilidade)
                    edge = next((e for e in edges_from_current if not e.get('sourceHandle')), None)
                    if not edge and len(edges_from_current) == 1:
                        edge = edges_from_current[0]
                    
                    if edge:
                        logger.info(f"[ChatbotEngine] Usando fallback para: {edge.get('target')}")
                    else:
                        logger.error(f"[ChatbotEngine] Ambiguidade de roteamento! {len(edges_from_current)} saídas mas nenhuma bate com {button_id}")
                        return None, "Ambiguidade de roteamento"
            else:
                logger.info(f"[ChatbotEngine] Mensagem de texto simples. Buscando aresta padrão (sem handle).")
                # Mensagem de texto: pegamos a primeira aresta ou a que tem sourceHandle nulo
                edge = next((e for e in edges if e.get('source') == current_node_id and not e.get('sourceHandle')), None)
                if not edge:
                    edge = next((e for e in edges if e.get('source') == current_node_id), None)
            
            if edge:
                next_node = next((n for n in nodes if n.get('id') == edge.get('target')), None)
                logger.info(f"[ChatbotEngine] Aresta encontrada: {edge.get('id')} | target={edge.get('target')} | sourceHandle={edge.get('sourceHandle')} | next_node={'ENCONTRADO: ' + next_node.get('id') if next_node else 'NÃO ENCONTRADO'}")
                logger.info(f"[ChatbotEngine] IDs de nós disponíveis: {[n.get('id') for n in nodes]}")
            else:
                logger.warning(f"[ChatbotEngine] Nenhuma aresta saindo de {current_node_id}. Arestas disponíveis: {[(e.get('source'), e.get('target'), e.get('sourceHandle')) for e in edges]}")
            
            if not next_node:
                logger.warning(f"[ChatbotEngine] Nó atual {current_node_id} é um beco sem saída ou transição inválida. Resetando para o início.")
                current_node_id = None # Força reinício abaixo

        if not current_node_id:
            # Iniciar fluxo: procurar nó do tipo 'start'
            start_node = next((n for n in nodes if n.get('type') == 'start'), None)
            if start_node:
                logger.info(f"[ChatbotEngine] Iniciando novo fluxo para conv {conversation_id}")
                # Encontrar o primeiro nó conectado ao start
                edge = next((e for e in edges if e.get('source') == start_node.get('id')), None)
                if edge:
                    next_node = next((n for n in nodes if n.get('id') == edge.get('target')), None)
                else:
                    # Se o start não tiver aresta, talvez o próprio start seja executável (raro)
                    next_node = start_node

        if next_node:
            logger.info(f"[ChatbotEngine] Próximo nó encontrado: {next_node.get('id')} ({next_node.get('type')})")
            await ChatbotEngine.execute_node(provedor_id, conversation_id, next_node, flow)
            return True, "Fluxo avançado/iniciado"
        
        logger.warning(f"[ChatbotEngine] Nenhum nó seguinte encontrado para conv {conversation_id}. Mensagem ignorada pelo Chatbot.")
        return False, "Nenhum nó seguinte encontrado"

    @staticmethod
    async def execute_node(provedor_id: int, conversation_id: int, node: Dict[str, Any], flow: ChatbotFlow):
        """
        Executa a ação de um nó específico (ex: enviar mensagem).
        """
        node_id = node.get('id')
        node_type = node.get('type')
        node_data = node.get('data', {})

        logger.info(f"[ChatbotEngine] Executando nó {node_id} ({node_type}) para conv {conversation_id}")

        if node_type in ['message', 'menu']:
            try:
                content = node_data.get('content', '...')
                buttons = node_data.get('buttons', [])
                rows = node_data.get('rows', [])
                button_text = node_data.get('buttonText', 'Ver Opções')
                section_title = node_data.get('sectionTitle', 'Selecione uma opção')
                header = node_data.get('headerText') or node_data.get('header')
                footer = node_data.get('footerText') or node_data.get('footer')
                
                from conversations.models import Conversation
                
                logger.info(f"[ChatbotEngine] Preparando envio de {node_type} para conversa {conversation_id}")
                
                conversation = await sync_to_async(Conversation.objects.select_related('inbox', 'inbox__provedor', 'contact').get)(id=conversation_id)
                
                success, response = await ChatbotEngine.send_message_agnostic(
                    conv=conversation, 
                    text=content, 
                    msg_btns=buttons, 
                    msg_header=header, 
                    msg_footer=footer,
                    msg_rows=rows,
                    msg_btn_text=button_text,
                    msg_sec_title=section_title
                )
                logger.info(f"[ChatbotEngine] Resultado do envio do nó {node_id}: success={success}, response={response}")

                if success:
                    # Atualizar estado no Redis — MERGE para preservar o flow_context (ex: CPF salvo)
                    existing_state = await redis_memory_service.get_ai_state(provedor_id, conversation_id, "whatsapp", "unknown")
                    existing_state["chatbot_node_id"] = node_id
                    existing_state["flow_id"] = flow.id
                    await redis_memory_service.update_ai_state(
                        provedor_id, 
                        conversation_id, 
                        existing_state,
                        "whatsapp",
                        "unknown"
                    )
                    
                    # NÃO avançar automaticamente para o próximo nó!
                    # Nós do tipo 'message' sem botões devem AGUARDAR input do usuário.
                    # O avanço ocorre quando o usuário enviar a próxima mensagem.
            except Exception as e:
                logger.error(f"[ChatbotEngine] Erro crítico ao executar nó {node_id}: {e}", exc_info=True)

        elif node_type == 'start':
            # Apenas pula para o próximo
            edges = flow.edges
            nodes = flow.nodes
            edge = next((e for e in edges if e.get('source') == node_id), None)
            if edge:
                next_node = next((n for n in nodes if n.get('id') == edge.get('target')), None)
                if next_node:
                    await ChatbotEngine.execute_node(provedor_id, conversation_id, next_node, flow)

        elif node_type == 'sgp':
            try:
                sgp_action = node_data.get('sgpAction', 'consultar_cliente')
                input_var = node_data.get('inputVar', 'cpf')
                error_message = node_data.get('errorMessage', 'Não foi possível consultar seus dados. Tente novamente.')

                # Obter o domínio/conversa para enviar feedback ao usuário depois
                from conversations.models import Conversation
                conversation = await sync_to_async(Conversation.objects.select_related('inbox', 'inbox__provedor', 'contact').get)(id=conversation_id)

                # Ler estado atual do Redis para obter o valor da variável de entrada
                current_state = await redis_memory_service.get_ai_state(provedor_id, conversation_id, "whatsapp", "unknown")
                flow_context = current_state.get('flow_context', {})
                input_value = flow_context.get(input_var)

                # Fallback: última mensagem de texto do usuário
                if not input_value:
                    input_value = current_state.get('last_user_message', '')

                logger.info(f"[ChatbotEngine][SGP] Executando ação '{sgp_action}' com {input_var}='{input_value}' para conv {conversation_id}")

                if not input_value:
                    logger.warning(f"[ChatbotEngine][SGP] Variável '{input_var}' não encontrada no contexto. Enviando mensagem de erro.")
                    await ChatbotEngine.send_message_agnostic(conv=conversation, text=f"Para continuar, preciso do valor de '{input_var}'. Por favor, informe.")
                    return

                # Obter configurações do SGP do provedor
                provedor = conversation.inbox.provedor
                sgp_config = provedor.integracoes_externas.get('sgp', {})
                sgp_url = sgp_config.get('base_url') or provedor.integracoes_externas.get('sgp_url')
                sgp_token = sgp_config.get('token') or provedor.integracoes_externas.get('sgp_token')
                sgp_app = sgp_config.get('app') or provedor.integracoes_externas.get('sgp_app', 'NioChat')

                if not sgp_url or not sgp_token:
                    logger.error(f"[ChatbotEngine][SGP] Configuração SGP não encontrada para provedor {provedor_id}")
                    await ChatbotEngine.send_message_agnostic(conv=conversation, text=error_message)
                    return

                from core.sgp_client import SGPClient
                sgp = SGPClient(base_url=sgp_url, token=sgp_token, app_name=sgp_app)

                result = None
                result_context = {}

                # Despachar para o endpoint correto
                if sgp_action == 'consultar_cliente':
                    result = await sync_to_async(sgp.consultar_cliente)(input_value)
                    if result:
                        contratos = result.get('contratos', [])
                        primeiro = contratos[0] if contratos else {}
                        # Nome vem dentro de contratos[0].razaoSocial (não na raiz!)
                        nome = (
                            result.get('razaoSocial') or result.get('nomeCliente') or result.get('nome') or
                            primeiro.get('razaoSocial') or primeiro.get('nomeCliente') or primeiro.get('nome', '')
                        )
                        nome_upper = nome.upper() if nome else 'CLIENTE'

                        # === FORMATAR E ENVIAR MENSAGEM DE CONTRATOS ===
                        if len(contratos) == 0:
                            await ChatbotEngine.send_message_agnostic(conv=conversation, text=f"❌ Nenhum contrato encontrado para o CPF/CNPJ informado.")
                            return

                        elif len(contratos) == 1:
                            c = contratos[0]
                            num = c.get('contratoId') or c.get('contrato_id') or c.get('contrato', '')
                            end = _formatar_endereco(c)
                            texto = f"*{nome_upper}*, contrato localizado:\n\n1 - Contrato ({num}): *{end}*"
                            await ChatbotEngine.send_message_agnostic(conv=conversation, text=texto)

                        else:
                            linhas = [f"*{nome_upper}*, encontramos mais de um contrato. Escolha o contrato desejado:\n"]
                            rows = []
                            for i, c in enumerate(contratos, 1):
                                num = c.get('contratoId') or c.get('contrato_id') or c.get('contrato', '')
                                end = _formatar_endereco(c)
                                linhas.append(f"{i} - Contrato ({num}): {end}")
                                rows.append({
                                    'id': f'sgp_contrato_{num}',
                                    'title': f'Contrato {num}',
                                    'description': end[:72]
                                })
                            await ChatbotEngine.send_message_agnostic(conv=conversation, text="\n".join(linhas))
                            import asyncio
                            await asyncio.sleep(0.8)
                            await ChatbotEngine.send_message_agnostic(
                                conv=conversation,
                                text="Selecione o contrato desejado:",
                                msg_rows=rows,
                                msg_btn_text="Ver Contratos",
                                msg_sec_title="Meus Contratos"
                            )
                            # Salvar estado de seleção pendente
                            current_state2 = await redis_memory_service.get_ai_state(provedor_id, conversation_id, "whatsapp", "unknown")
                            fc2 = current_state2.get('flow_context', {})
                            fc2['contratos_pendentes'] = contratos
                            fc2['nome'] = nome
                            current_state2['flow_context'] = fc2
                            current_state2['chatbot_node_id'] = f'sgp_select_{node_id}'
                            current_state2['flow_id'] = flow.id
                            await redis_memory_service.update_ai_state(provedor_id, conversation_id, current_state2, "whatsapp", "unknown")
                            return  # Aguardar seleção do usuário

                        # Contexto para 1 contrato (ou continuação após seleção)
                        num_contrato = (
                            primeiro.get('id') or primeiro.get('contratoId') or primeiro.get('contrato_id') or
                            primeiro.get('contrato') or primeiro.get('numero') or primeiro.get('idContrato') or ''
                        )
                        result_context = {
                            'nome': nome,
                            'contratos': contratos,
                            'sgp_cliente': result,
                            'contrato': str(num_contrato),
                            'cliente_id': str(primeiro.get('cliente_id', '') or primeiro.get('clienteId', '')),
                            'status_contrato': str(primeiro.get('contratoStatus', '')),
                            'cidade': primeiro.get('popNome', '') or primeiro.get('endereco_cidade', ''),
                            'endereco': _formatar_endereco(primeiro),
                            'vencimento': primeiro.get('dataVencimento', '') or primeiro.get('data_vencimento', ''),
                        }
                        logger.info(f"[ChatbotEngine][SGP] Nome extraído: '{nome}' | Contrato: '{num_contrato}'")

                elif sgp_action == 'verifica_acesso':
                    result = await sync_to_async(sgp.verifica_acesso)(input_value)
                    if result:
                        result_context = {
                            'status_acesso': result.get('status') or result.get('status_conexao', ''),
                            'sgp_acesso': result
                        }

                elif sgp_action == 'listar_contratos':
                    result = await sync_to_async(sgp.listar_contratos)(input_value)
                    result_context = {'contratos': result, 'sgp_contratos': result}

                elif sgp_action == 'segunda_via_fatura':
                    result = await sync_to_async(sgp.segunda_via_fatura)(input_value)
                    if result:
                        # Tentar extrair link de boleto da resposta
                        link = result.get('link') or result.get('url') or result.get('boleto_url', '')
                        result_context = {'link_fatura': link, 'sgp_fatura': result}

                elif sgp_action == 'listar_titulos':
                    # Determinar se buscamos por CPF ou por Contrato (se disponível no contexto)
                    contrato_id_ctx = flow_context.get('contrato') or flow_context.get('contrato_id')
                    cpf_ctx = flow_context.get('cpf') or flow_context.get('cpfcnpj') or input_value
                    
                    if contrato_id_ctx:
                        # Se contrato parece CPF, usar como CPF
                        is_cpf_contract = len(str(contrato_id_ctx)) in [11, 14]
                        if is_cpf_contract:
                            result = await sync_to_async(sgp.listar_titulos)(cpf_cnpj=contrato_id_ctx)
                        else:
                            result = await sync_to_async(sgp.listar_titulos)(contrato=contrato_id_ctx)
                    else:
                        result = await sync_to_async(sgp.listar_titulos)(cpf_cnpj=cpf_ctx)
                    
                    if isinstance(result, dict):
                        logger.info(f"[ChatbotEngine][V2.1] listar_titulos response keys: {list(result.keys())}")
                        # SGP Raw response uses 'titulos' key, not 'links'
                        faturas_raw = result.get('titulos', [])
                        faturas_vencidas = []
                        faturas_abertas = []
                        
                        hoje = date.today()
                        
                        for f in faturas_raw:
                            if not isinstance(f, dict):
                                continue
                            
                            # Mapeamento de campos SGP Raw (conforme fatura_service.py)
                            # f.get('status') pode vir como 'aberto' mesmo vencido
                            status = str(f.get('status', '')).lower()
                            venc_str = f.get('dataVencimento', '')
                            is_vencida = status == 'vencida'
                            
                            try:
                                if venc_str and status == 'aberto':
                                    venc_dt = datetime.strptime(venc_str, '%Y-%m-%d').date()
                                    if venc_dt < hoje:
                                        is_vencida = True
                            except:
                                pass

                            if is_vencida:
                                faturas_vencidas.append(f)
                            elif status == 'aberto':
                                faturas_abertas.append(f)
                        
                        # Prioridade 1: Múltiplas faturas vencidas -> Transferir Financeiro
                        if len(faturas_vencidas) > 1:
                            text_alert = "Detectamos que você possui múltiplas faturas vencidas. Para garantir um melhor atendimento, estamos transferindo você para o setor financeiro."
                            await ChatbotEngine.send_message_agnostic(conv=conversation, text=text_alert)
                            # TODO: Implementar transferToSector se houver suporte no motor
                            result_context = {'status_faturas': 'multiplas_vencidas', 'transferir': 'financeiro'}
                        
                        # Prioridade 2: Uma fatura vencida -> Enviar Pix Formatado
                        elif len(faturas_vencidas) == 1:
                            f = faturas_vencidas[0]
                            vencimento = f.get('dataVencimento', '')
                            # Formatar data YYYY-MM-DD -> DD/MM/YYYY
                            if '-' in vencimento:
                                d_pts = vencimento.split('-')
                                if len(d_pts) == 3:
                                    vencimento = f"{d_pts[2]}/{d_pts[1]}/{d_pts[0]}"
                            
                            valor = float(f.get('valorCorrigido') or f.get('valor') or 0.0)
                            f_id = f.get('numeroDocumento') or f.get('id') or f.get('fatura')
                            msg = f"\n💳 *Sua fatura vencida:*\n\nFatura ID: {f_id}\nVencimento: {vencimento}\nValor: R$ {valor:.2f}\n\nSegue abaixo as opções para pagamento."
                            
                            pix_code = f.get('codigoPix') or f.get('codigopix')
                            if pix_code:
                                items = [{
                                    "retailer_id": str(f_id),
                                    "name": f"Fatura Internet - {vencimento}",
                                    "amount": {"value": int(valor * 100), "offset": 100},
                                    "quantity": 1
                                }]
                                # merchant_name e key vêm das configurações do provedor/SGP se disponíveis
                                merchant = sgp_config.get('pix_merchant_name', provedor.nome)
                                pix_key = sgp_config.get('pix_key')
                                pix_key_type = "CNPJ" # Fallback padrão

                                if not pix_key:
                                    # Tentar extrair da chave PIX bruta
                                    pix_key, pix_key_type = ChatbotEngine._extract_pix_info(pix_code)
                                
                                await ChatbotEngine.send_order_details_pix(
                                    conv=conversation,
                                    content=msg,
                                    pix_code=pix_code,
                                    merchant_name=merchant,
                                    key=pix_key,
                                    key_type=pix_key_type,
                                    amount_value=valor,
                                    reference_id=str(f_id),
                                    items_list=items
                                )
                            else:
                                await ChatbotEngine.send_message_agnostic(conv=conversation, text=msg)
                            
                            result_context = {'status_faturas': 'vencida_unica', 'fatura_ativa': f}
                        
                        # Prioridade 3: Fatura em aberto -> Enviar a mais recente
                        elif faturas_abertas:
                            f = faturas_abertas[0] # Geralmente a primeira é a mais próxima / recente
                            vencimento = f.get('dataVencimento', '')
                            if '-' in vencimento:
                                d_pts = vencimento.split('-')
                                if len(d_pts) == 3:
                                    vencimento = f"{d_pts[2]}/{d_pts[1]}/{d_pts[0]}"
                            
                            valor = float(f.get('valorCorrigido') or f.get('valor') or 0.0)
                            f_id = f.get('numeroDocumento') or f.get('id') or f.get('fatura')
                            msg = f"\n💳 *Sua fatura em aberto:*\n\nFatura ID: {f_id}\nVencimento: {vencimento}\nValor: R$ {valor:.2f}\n\nSegue abaixo as opções para pagamento."
                            
                            pix_code = f.get('codigoPix') or f.get('codigopix')
                            if pix_code:
                                items = [{
                                    "retailer_id": str(f_id),
                                    "name": f"Fatura Internet - {vencimento}",
                                    "amount": {"value": int(valor * 100), "offset": 100},
                                    "quantity": 1
                                }]
                                merchant = sgp_config.get('pix_merchant_name', provedor.nome)
                                pix_key = sgp_config.get('pix_key')
                                pix_key_type = "CNPJ"

                                if not pix_key:
                                    pix_key, pix_key_type = ChatbotEngine._extract_pix_info(pix_code)

                                await ChatbotEngine.send_order_details_pix(
                                    conv=conversation,
                                    content=msg,
                                    pix_code=pix_code,
                                    merchant_name=merchant,
                                    key=pix_key,
                                    key_type=pix_key_type,
                                    amount_value=valor,
                                    reference_id=str(f_id),
                                    items_list=items
                                )
                            else:
                                await ChatbotEngine.send_message_agnostic(conv=conversation, text=msg)
                            
                            result_context = {'status_faturas': 'aberta', 'fatura_ativa': f}
                        
                        # Prioridade 4: Nenhuma fatura -> Parabéns
                        else:
                            await ChatbotEngine.send_message_agnostic(conv=conversation, text="Parabéns, você não possui faturas vencidas ou em aberto no momento. 😊")
                            result_context = {'status_faturas': 'em_dia'}
                        
                        result_context['sgp_titulos'] = result

                        # Lógica de Encerramento Customizado (Solicitado pelo usuário)
                        if sgp_action == 'listar_titulos':
                            success_msg = node_data.get('successMessage')
                            auto_close = node_data.get('autoClose', False)
                            
                            # Condição: Só envia se não for erro
                            if result_context.get('status_faturas') != 'error':
                                if success_msg:
                                    await ChatbotEngine.send_message_agnostic(conv=conversation, text=success_msg)
                                    logger.info(f"[ChatbotEngine][SGP] Mensagem de sucesso enviada: {success_msg[:30]}...")
                                
                                if auto_close:
                                    await sync_to_async(closing_service.request_closing)(conversation)
                                    logger.info(f"[ChatbotEngine][SGP] Encerramento solicitado para conv {conversation_id}")
                    else:
                         result_context = {'status_faturas': 'error', 'msg': 'Não conseguimos acessar suas faturas no momento.'}

                elif sgp_action == 'gerar_pix':
                    result = await sync_to_async(sgp.gerar_pix)(input_value)
                    if result:
                        pix = result.get('emv') or result.get('pix') or result.get('code', '')
                        result_context = {'pix_code': pix, 'sgp_pix': result}

                elif sgp_action == 'liberar_por_confianca':
                    cpf_ctx = flow_context.get('cpf', '') or flow_context.get('cpfcnpj', '')
                    result = await sync_to_async(sgp.liberar_por_confianca)(input_value, cpf_cnpj=cpf_ctx)
                    if result:
                        result_context = {'sucesso': result.get('status') == 1, 'sgp_liberacao': result}

                elif sgp_action == 'criar_chamado':
                    conteudo = flow_context.get('conteudo', 'Chamado via Chatbot NioChat')
                    result = await sync_to_async(sgp.criar_chamado)(input_value, conteudo)
                    if result:
                        result_context = {
                            'protocolo': result.get('protocolo', ''),
                            'chamado_id': result.get('chamado_id', ''),
                            'sucesso': result.get('success', False),
                            'sgp_chamado': result
                        }

                elif sgp_action == 'listar_manutencoes':
                    result = await sync_to_async(sgp.listar_manutencoes)(input_value)
                    result_context = {'manutencoes': result, 'sgp_manutencoes': result}

                logger.info(f"[ChatbotEngine][SGP] Resultado ação '{sgp_action}': {list(result_context.keys())}")

                if result is None and result_context == {}:
                    # Consulta falhou ou retornou vazio
                    await ChatbotEngine.send_message_agnostic(conv=conversation, text=error_message)
                    return

                # Salvar resultado no contexto do Redis
                flow_context.update(result_context)
                current_state['flow_context'] = flow_context
                current_state['chatbot_node_id'] = node_id
                current_state['flow_id'] = flow.id
                await redis_memory_service.update_ai_state(provedor_id, conversation_id, current_state, "whatsapp", "unknown")

                # Avançar automaticamente para o próximo nó (ex: mensagem com resultado)
                import asyncio
                edges = flow.edges
                nodes = flow.nodes
                edge = next((e for e in edges if e.get('source') == node_id), None)
                if edge:
                    next_node = next((n for n in nodes if n.get('id') == edge.get('target')), None)
                    if next_node:
                        logger.info(f"[ChatbotEngine][SGP] Avançando automaticamente de {node_id} para {next_node.get('id')}")
                        # Substituir variáveis de contexto no conteúdo do próximo nó
                        next_node_data = dict(next_node.get('data', {}))
                        content = next_node_data.get('content', '')
                        for var_name, var_value in flow_context.items():
                            if isinstance(var_value, (str, int, float)):
                                content = str(content).replace(f'{{{{{var_name}}}}}', str(var_value))
                        next_node_data['content'] = content
                        next_node = dict(next_node)
                        next_node['data'] = next_node_data
                        await asyncio.sleep(1.0)
                        await ChatbotEngine.execute_node(provedor_id, conversation_id, next_node, flow)
                    else:
                        logger.warning(f"[ChatbotEngine][SGP] Próximo nó {edge.get('target')} não encontrado para transição de {node_id}")
                else:
                    # Sem próximo nó: a mensagem formatada já foi enviada acima
                    logger.info(f"[ChatbotEngine][SGP] Nenhum próximo nó configurado após SGP {node_id}.")

            except Exception as e:
                logger.error(f"[ChatbotEngine][SGP] Erro ao executar nó SGP {node_id}: {e}", exc_info=True)


    @staticmethod
    async def send_message_agnostic(conv, text, msg_btns=None, msg_header=None, msg_footer=None, msg_rows=None, msg_btn_text=None, msg_sec_title=None) -> Tuple[bool, Any]:
        """
        Helper para enviar mensagem baseada na integração (WhatsApp Cloud, Evolution, Uazapi)
        """
        inbox = conv.inbox
        provedor = inbox.provedor
        
        logger.info(f"[ChatbotEngine] Enviando mensagem para inbox {inbox.id} (canal: {inbox.channel_id}) | Texto: {text[:100]}...")

        # 1. WhatsApp Cloud API (Oficial)
        if inbox.channel_id == "whatsapp_cloud_api" or inbox.channel_type == "whatsapp_oficial" or (provedor.integracoes_externas.get('cloud_api_active') == True):
            if msg_btns or msg_rows:
                return await sync_to_async(send_via_whatsapp_cloud_api)(
                    conversation=conv,
                    content=text,
                    message_type='interactive',
                    buttons=msg_btns,
                    rows=msg_rows,
                    button_text=msg_btn_text,
                    section_title=msg_sec_title,
                    header=msg_header,
                    footer=msg_footer
                )
            else:
                return await sync_to_async(send_via_whatsapp_cloud_api)(
                    conversation=conv,
                    content=text,
                    message_type='text'
                )

        # 2. Evolution / Uazapi (Baseado em integrations/views.py)
        uazapi_token = provedor.integracoes_externas.get('whatsapp_token')
        uazapi_url = provedor.integracoes_externas.get('whatsapp_url')
        uazapi_instance = provedor.integracoes_externas.get('whatsapp_instance')
        
        if uazapi_token and uazapi_url:
            # Garantir URL correta (send/text)
            if not uazapi_url.endswith('/send/text'):
                base_url = uazapi_url.rstrip('/')
                # Tentar reconstruir se for apenas a base
                if '/instance/' in uazapi_url:
                    # Já parece ser uma URL completa mas talvez sem o final
                    pass
                else:
                    uazapi_url = f"{base_url}/message/sendText/{uazapi_instance}"
            
            payload = {
                "number": conv.contact.phone.replace('@s.whatsapp.net', '').replace('@c.us', ''),
            }
            
            if msg_btns or msg_rows:
                # Evolution/Uazapi suporte a botões varia, usando texto simples como fallback se não for Evolution v2
                all_items = (msg_btns or []) + (msg_rows or [])
                btn_text = text + "\n\n" + "\n".join([f"• {b['title']}" for b in all_items])
                payload["text"] = btn_text
            else:
                payload["text"] = text
                
            headers = {
                "apikey": uazapi_token, # Evolution usa apikey
                "token": uazapi_token,  # Uazapi usa token
                "Content-Type": "application/json"
            }
            
            try:
                # Tenta enviar via Evolution (mais comum no projeto)
                resp = await sync_to_async(requests.post)(
                    uazapi_url,
                    json=payload,
                    headers=headers,
                    timeout=15
                )
                return resp.status_code in [200, 201], resp.text
            except Exception as e:
                logger.error(f"[ChatbotEngine] Erro ao enviar Evolution/Uazapi: {e}")
                return False, str(e)
        
        return False, "Nenhuma integração compatível encontrada"
    
    @staticmethod
    async def send_order_details_pix(conv, content, pix_code, merchant_name, key, key_type, amount_value, reference_id, items_list) -> Tuple[bool, Any]:
        """
        Envia mensagem interativa de detalhes do pedido (review_and_pay) com Pix.
        """
        order_details = {
            "reference_id": reference_id,
            "type": "digital-goods",
            "payment_type": "br",
            "payment_settings": [
                {
                    "type": "pix_dynamic_code",
                    "pix_dynamic_code": {
                        "code": pix_code,
                        "merchant_name": merchant_name,
                        "key": key,
                        "key_type": key_type
                    }
                }
            ],
            "currency": "BRL",
            "total_amount": {
                "value": int(amount_value * 100),
                "offset": 100
            },
            "order": {
                "status": "pending",
                "items": items_list,
                "subtotal": {
                    "value": int(amount_value * 100),
                    "offset": 100
                }
            }
        }
        
        return await sync_to_async(send_via_whatsapp_cloud_api)(
            conversation=conv,
            content=content,
            message_type='order_details',
            order_details=order_details
        )

    @staticmethod
    def _extract_pix_info(codigo_pix: str) -> Tuple[str, str]:
        """
        Extrai chave e tipo de chave de um código PIX (EMV ou chave direta).
        Lógica baseada no FaturaService.
        """
        pix_key = ""
        pix_key_type = "EVP"
        
        if not codigo_pix:
            return pix_key, pix_key_type

        # 1. Se for QR Code EMV
        if codigo_pix.startswith('000201'):
            try:
                # Procurar padrões comuns dentro do EMV
                # CPF (11)
                for match in re.finditer(r'\b\d{11}\b', codigo_pix):
                    if match.start() > 10 and len(set(match.group())) > 1:
                        return match.group(), "CPF"
                # CNPJ (14)
                for match in re.finditer(r'\b\d{14}\b', codigo_pix):
                    if match.start() > 10 and len(set(match.group())) > 1:
                        return match.group(), "CNPJ"
                # Email
                email = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', codigo_pix)
                if email:
                    return email.group(), "EMAIL"
                # Telefone
                for pattern in [r'\+55\d{10,11}', r'\b55\d{10,11}\b']:
                    for m in re.finditer(pattern, codigo_pix):
                        if m.start() > 10 and not m.group().startswith('0002'):
                            return m.group().lstrip('+'), "PHONE"
                
                # Fallback EVP determinístico
                pix_key = str(uuid.uuid5(uuid.NAMESPACE_DNS, codigo_pix[:50]))
            except:
                pix_key = str(uuid.uuid5(uuid.NAMESPACE_DNS, codigo_pix[:50]))
        
        # 2. Se for chave direta
        elif len(codigo_pix) == 11 and codigo_pix.isdigit():
            return codigo_pix, "CPF"
        elif len(codigo_pix) == 14 and codigo_pix.isdigit():
            return codigo_pix, "CNPJ"
        elif '@' in codigo_pix:
            return codigo_pix, "EMAIL"
        elif codigo_pix.startswith('+55') or (codigo_pix.startswith('55') and len(codigo_pix) >= 12):
            return codigo_pix.lstrip('+'), "PHONE"
        elif '-' in codigo_pix and len(codigo_pix) == 36:
            return codigo_pix, "EVP"
        else:
            # Resíduo
            pix_key = str(uuid.uuid5(uuid.NAMESPACE_DNS, codigo_pix[:50])) if len(codigo_pix) > 50 else codigo_pix
            pix_key_type = "EVP"

        return pix_key, pix_key_type

    @staticmethod
    async def handle_button_click(provedor_id: int, conversation_id: int, button_id: str):
        """
        Trata o clique em um botão interativo.
        """
        logger.info(f"[ChatbotEngine] Botão clicado: {button_id} na conv {conversation_id}")
        return await ChatbotEngine.process_message(provedor_id, conversation_id, "", button_id=button_id)
