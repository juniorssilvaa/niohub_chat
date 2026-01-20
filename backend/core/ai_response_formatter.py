import re
import json
import logging
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime
from django.utils import timezone
from google import genai

logger = logging.getLogger(__name__)

class AIResponseFormatter:
    """
    Sub-agente responsável pela formatação, limpeza e refinamento das respostas da IA.
    Garante que a comunicação seja natural e adequada ao canal (WhatsApp/Telegram).
    """

    def __init__(self, openai_service=None):
        self.openai_service = openai_service

    def _determinar_genero_nome(self, nome: str) -> str:
        """
        Determina o gênero do nome do agente baseado em terminações comuns.
        Retorna 'masculino' ou 'feminino'.
        """
        if not nome:
            return 'masculino'
        
        nome_lower = nome.lower().strip()
        terminacoes_femininas = ['a', 'ia', 'eia', 'ana', 'ela', 'ina', 'iana', 'ara', 'ora']
        
        for term in terminacoes_femininas:
            if nome_lower.endswith(term) and len(nome_lower) > 2:
                return 'feminino'
        
        terminacoes_masculinas = ['o', 'io', 'eo', 'ão', 'ino', 'ano', 'eno', 'uno']
        for term in terminacoes_masculinas:
            if nome_lower.endswith(term) and len(nome_lower) > 1:
                return 'masculino'
        
        if nome_lower[-1] in ['e', 'i', 'u'] or (nome_lower[-1].isalpha() and nome_lower[-1] not in 'aeiou'):
            return 'masculino'
        
        return 'masculino'

    def _get_greeting_time(self) -> str:
        """Retorna saudação baseada no horário atual"""
        now = datetime.now()
        hour = now.hour
        
        if 5 <= hour < 12:
            return "Bom dia"
        elif 12 <= hour < 18:
            return "Boa tarde"
        else:
            return "Boa noite"

    def remover_exposicao_funcoes(self, resposta: str) -> str:
        """
        Remove qualquer exposição de funções internas, chamadas de funções, código ou dados técnicos da resposta.
        CRÍTICO: Remove estruturas JSON, resultados brutos de funções, e qualquer dado do backend.
        """
        if not resposta:
            return resposta
        
        # 🚨 REMOVER ESTRUTURAS JSON/DICT COMPLETAS (CRÍTICO DE SEGURANÇA)
        # Remove padrões como: {'success': True, ...}, {"horario_info": {...}}, etc.
        resposta = re.sub(r'\{[^{}]*["\']success["\']\s*:\s*[^,}]+[^}]*\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'\{[^{}]*["\']horario_info["\']\s*:\s*\{[^}]*\}[^}]*\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'\{[^{}]*["\']dentro_horario["\']\s*:\s*[^,}]+[^}]*\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'\{[^{}]*["\']message["\']\s*:\s*[^,}]+[^}]*\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'Resultado\s*:\s*\{[^}]+\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'Result\s*:\s*\{[^}]+\}', '', resposta, flags=re.IGNORECASE)
        
        # Remover linhas que começam com "Resultado:" ou "Result:"
        resposta = re.sub(r'^Resultado\s*:.*$', '', resposta, flags=re.IGNORECASE | re.MULTILINE)
        resposta = re.sub(r'^Result\s*:.*$', '', resposta, flags=re.IGNORECASE | re.MULTILINE)
        
        # Remover estruturas JSON completas (dicts e lists)
        resposta = re.sub(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', '', resposta)
        resposta = re.sub(r'\[[^\]]*(?:\{[^}]*\}[^\]]*)*\]', '', resposta)
        
        funcoes_proibidas = [
            'consultar_cliente_sgp', 'verificar_acesso_sgp', 'criar_chamado_tecnico',
            'liberar_pagamento', 'gerar_fatura_completa', 'enviar_qr_code_pix',
            'enviar_boleto_pdf', 'encerrar_atendimento', 'buscar_equipes_disponiveis',
            'executar_transferencia_conversa', 'transferir_conversa_inteligente'
        ]
        
        for funcao in funcoes_proibidas:
            padrao = re.compile(re.escape(funcao) + r'\s*\([^)]*\)', re.IGNORECASE)
            resposta = padrao.sub('', resposta)
            
            padrao_nome = re.compile(r'\b' + re.escape(funcao) + r'\b', re.IGNORECASE)
            resposta = padrao_nome.sub('', resposta)
        
        padrao_codigo = re.compile(
            r'\b(?:' + '|'.join(re.escape(f) for f in funcoes_proibidas) + r')\s*[=:\(][^\)]*\)?',
            re.IGNORECASE
        )
        resposta = padrao_codigo.sub('', resposta)
        
        # Remover padrões de exposição de dados técnicos
        resposta = re.sub(r'["\']success["\']\s*:\s*(?:True|False)', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'["\']horario_info["\']\s*:\s*\{[^}]*\}', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'["\']dentro_horario["\']\s*:\s*(?:True|False)', '', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'["\']message["\']\s*:\s*["\'][^"\']+["\']', '', resposta, flags=re.IGNORECASE)
        
        # CORREÇÃO: Não usar re.sub(r'\s+', ' ', resposta) pois remove quebras de linha
        # Preservar quebras de linha mas remover espaços duplicados horizontais
        resposta = re.sub(r'[ \t]+', ' ', resposta)
        # Normalizar múltiplas quebras de linha para no máximo duas
        resposta = re.sub(r'\n\s*\n\s*\n+', '\n\n', resposta)
        
        return resposta.strip()

    def _reescrever_mensagem_repetida(self, resposta: str) -> str:
        """
        Reescreve uma mensagem repetida usando sinônimos para evitar soar robótico.
        """
        if not resposta:
            return resposta
        
        sinonimos = {
            'verificar': ['checar', 'analisar', 'consultar', 'ver', 'examinar'],
            'entender': ['compreender', 'identificar', 'descobrir', 'saber', 'perceber'],
            'problema': ['situação', 'questão', 'dificuldade', 'ocorrência'],
            'ajudar': ['auxiliar', 'apoiar', 'atender', 'resolver', 'assistir'],
            'fazer': ['realizar', 'executar', 'efetuar', 'concretizar', 'praticar'],
            'conexão': ['conectividade', 'acesso', 'link', 'vínculo', 'ligação'],
            'internet': ['conexão', 'acesso', 'rede', 'serviço', 'link'],
            'agora': ['neste momento', 'já', 'imediatamente', 'agora mesmo', 'neste instante'],
            'vou': ['irei', 'vou', 'pretendo', 'farei', 'realizarei']
        }
        
        palavras = resposta.split()
        palavras_reescritas = []
        
        for palavra in palavras:
            palavra_lower = palavra.lower().strip('.,!?;:')
            if palavra_lower in sinonimos:
                hash_valor = int(hashlib.md5(palavra_lower.encode()).hexdigest(), 16)
                sinonimo = sinonimos[palavra_lower][hash_valor % len(sinonimos[palavra_lower])]
                if palavra[0].isupper():
                    sinonimo = sinonimo.capitalize()
                palavras_reescritas.append(sinonimo + palavra[len(palavra_lower):])
            else:
                palavras_reescritas.append(palavra)
        
        resposta_reescrita = ' '.join(palavras_reescritas)
        
        if resposta_reescrita.lower() == resposta.lower():
            prefixos = ['Vou', 'Agora vou', 'Já vou', 'Irei', 'Vou já']
            hash_valor = int(hashlib.md5(resposta.encode()).hexdigest(), 16)
            prefixo = prefixos[hash_valor % len(prefixos)]
            resposta_reescrita = f"{prefixo} {resposta_reescrita.lower()}"
        
        return resposta_reescrita.strip()

    def adicionar_quebras_linha_automaticas(self, texto: str) -> str:
        """
        Adiciona quebras de linha automaticamente em mensagens grandes para melhor legibilidade.
        """
        if not texto or len(texto) <= 100:
            return texto
        
        padroes_quebra = [
            (r'\.\s+([A-Z])', r'.\n\n\1'),
            (r'!\s+([A-Z])', r'!\n\n\1'),
            (r'\?\s+([A-Z])', r'?\n\n\1'),
            (r'CONTRATO\s+(\d+)', r'\n\nCONTRATO \1'),
            (r'Endereço:\s+', r'\nEndereço: '),
            (r'Contrato:\s+', r'\nContrato: '),
            (r'Cliente:\s+', r'\nCliente: '),
        ]
        
        for padrao, substituicao in padroes_quebra:
            texto = re.sub(padrao, substituicao, texto)
        
        texto = re.sub(r'\n{3,}', '\n\n', texto)
        return texto.strip().replace('\\n', '\n')

    def normalizar_resposta(self, resposta: Any) -> str:
        """
        Normaliza a resposta para garantir que seja sempre uma string válida,
        removendo formatação JSON/array indesejada e exposição de funções.
        """
        if not resposta:
            return ""
        
        if isinstance(resposta, list):
            resposta = ' '.join(str(item) for item in resposta)
        elif not isinstance(resposta, str):
            resposta = str(resposta)
        
        resposta = resposta.strip()
        
        if resposta.startswith('[') and resposta.endswith(']'):
            try:
                parsed = json.loads(resposta)
                if isinstance(parsed, list) and len(parsed) > 0:
                    resposta = str(parsed[0])
                else:
                    resposta = ""
            except:
                match = re.match(r'^\["?\'?(.*?)"?\'?\]$', resposta)
                if match:
                    resposta = match.group(1).strip('"').strip("'")
                else:
                    resposta = resposta.strip('[]').strip('"').strip("'")
        
        if (resposta.startswith('"') and resposta.endswith('"')) or (resposta.startswith("'") and resposta.endswith("'")):
            resposta = resposta.strip('"').strip("'")
        
        return self.remover_exposicao_funcoes(resposta)

    def _corrigir_formato_dados_cliente(self, texto: str) -> str:
        """
        Corrige o formato de apresentação dos dados do cliente para garantir quebras de linha corretas.
        """
        if not texto:
            return texto
        
        padrao_incorreto = re.compile(
            r'(\*[A-Z\s]+\*),\s*contrato localizado:\s*1\s*-\s*Contrato\s*\((\d+)\):\s*(\*[^*]+\*)(.*?)(Como posso lhe ser útil\?)',
            re.IGNORECASE | re.DOTALL
        )
        
        def substituir_formato(match):
            nome = match.group(1)
            contrato_id = match.group(2)
            endereco = match.group(3)
            texto_extra = match.group(4).strip() if match.group(4) else ""
            pergunta = match.group(5) if match.group(5) else ""
            
            resultado = f"{nome}\n\ncontrato localizado:\n\n1 - Contrato ({contrato_id}): {endereco}"
            if texto_extra:
                resultado += f"\n\n{texto_extra}"
            if pergunta:
                resultado += f"\n\n{pergunta}"
            
            return resultado
        
        texto_corrigido = padrao_incorreto.sub(substituir_formato, texto)
        
        padrao_sem_pergunta = re.compile(
            r'(\*[A-Z\s]+\*),\s*contrato localizado:\s*1\s*-\s*Contrato\s*\((\d+)\):\s*(\*[^*]+\*)',
            re.IGNORECASE | re.DOTALL
        )
        
        def substituir_sem_pergunta(match):
            nome = match.group(1)
            contrato_id = match.group(2)
            endereco = match.group(3)
            return f"{nome}\n\ncontrato localizado:\n\n1 - Contrato ({contrato_id}): {endereco}\n\nComo posso lhe ser útil?"
        
        return padrao_sem_pergunta.sub(substituir_sem_pergunta, texto_corrigido)

    def _forcar_formato_confirmacao_dados(self, resposta: str, conversation_id: int = None, provedor_id: int = None, channel: str = "wa", phone: str = "unknown") -> str:
        """
        Força o formato obrigatório de CONFIRMAÇÃO DE DADOS DO CONTRATO com quebras de linha.
        """
        if 'CONFIRMAÇÃO DE DADOS DO CONTRATO' not in resposta:
            return resposta
        
        nome_match = re.search(r'Cliente:\s*([^\n]+?)(?:\s+Contrato|$)', resposta, re.IGNORECASE)
        if not nome_match:
            nome_match = re.search(r'Cliente:\s*([A-Z][^\n]{3,}?)(?:\n|$)', resposta, re.IGNORECASE)
        
        contrato_match = re.search(r'Contrato[:\s]+(\d{3,})', resposta, re.IGNORECASE)
        endereco_match = re.search(r'Endereço[:\s]+([^\n]{10,}?)(?:\s+Essas|$)', resposta, re.IGNORECASE)
        
        nome_cliente = nome_match.group(1).strip() if nome_match else None
        numero_contrato = contrato_match.group(1).strip() if contrato_match else None
        endereco_completo = endereco_match.group(1).strip() if endereco_match else None
        
        if (not nome_cliente or not numero_contrato or not endereco_completo) and conversation_id and provedor_id:
            try:
                from .redis_memory_service import redis_memory_service
                memoria = redis_memory_service.get_conversation_memory_sync(provedor_id, conversation_id, channel, phone)
                if memoria:
                    nome_cliente = nome_cliente or memoria.get('nome_cliente')
                    numero_contrato = numero_contrato or str(memoria.get('contrato_id'))
                    endereco_completo = endereco_completo or memoria.get('endereco')
            except:
                pass
        
        if nome_cliente and numero_contrato and endereco_completo:
            resposta_formatada = f"CONFIRMAÇÃO DE DADOS DO CONTRATO\n\nCliente: {nome_cliente}\nContrato: {numero_contrato}\nEndereço: {endereco_completo}"
            if 'Essas informações estão corretas?' in resposta:
                resposta_formatada += "\n\nEssas informações estão corretas?"
            return resposta_formatada
        
        # Fallback: apenas garantir quebras de linha básicas
        resposta = re.sub(r'CONFIRMAÇÃO DE DADOS DO CONTRATO\s+', r'CONFIRMAÇÃO DE DADOS DO CONTRATO\n\n', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'Cliente:\s+([^\n]+?)(?=\s+Contrato)', r'Cliente: \1\n', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'Contrato:\s+(\d+)(?=\s+Endereço)', r'Contrato: \1\n', resposta, flags=re.IGNORECASE)
        resposta = re.sub(r'Endereço:\s+([^\n]+?)(?=\s+Essas)', r'Endereço: \1\n\n', resposta, flags=re.IGNORECASE)
        
        return resposta

    def corrigir_formato_resposta(self, resposta: str, conversation_id: int = None, provedor_id: int = None, channel: str = "wa", phone: str = "unknown") -> str:
        """
        Força o formato correto da resposta final, integrando todas as limpezas.
        """
        resposta = self.normalizar_resposta(resposta)
        
        if 'CONFIRMAÇÃO DE DADOS DO CONTRATO' in resposta:
            resposta = self._forcar_formato_confirmacao_dados(resposta, conversation_id, provedor_id, channel, phone)
        
        # Corrigir formatos antigos
        if any(termo in resposta for termo in ['*Dados do Cliente:*', '*Nome:*', '*Status do Contrato:*']):
            nome_match = re.search(r'([A-Z\s]+(?:DA|DE|DO|DOS|DAS|E)\s+[A-Z\s]+)', resposta)
            if nome_match:
                nome_cliente = nome_match.group(1).strip()
                if 'Suspenso' in resposta or 'Ativo' in resposta or any(char.isdigit() for char in resposta):
                    resposta = f"CONFIRMAÇÃO DE DADOS DO CONTRATO\n\nCliente: {nome_cliente}\nContrato: [NÚMERO DO CONTRATO]\nEndereço: [ENDEREÇO COMPLETO]"
        
        # Adicionar delay se for confirmação de dados (lógica do sistema)
        if 'CONFIRMAÇÃO DE DADOS DO CONTRATO' in resposta and 'Essas informações estão corretas?' in resposta:
            import time
            time.sleep(2) # Delay reduzido para 2s na formatação, o envio original tinha 5s
            
        return self.adicionar_quebras_linha_automaticas(resposta)

    def variar_primeira_resposta(self, resposta: str, provedor) -> str:
        """
        Gera primeira mensagem variada seguindo o formato solicitado.
        """
        nome_provedor = provedor.nome or 'Provedor'
        saudacao = self._get_greeting_time()
        
        uso_emojis = provedor.uso_emojis or ""
        uso_emojis_lower = uso_emojis.lower()
        
        emoji_opcoes = ["😄", "😊", "👋", "✨"]
        emoji_final = ""
        
        if uso_emojis_lower in ['sempre', 'sim', 'yes']:
            h = int(hashlib.md5(nome_provedor.encode()).hexdigest(), 16)
            emoji_final = f" {emoji_opcoes[h % len(emoji_opcoes)]}"
        elif uso_emojis_lower in ['ocasionalmente', 'ocasional', 'sometimes']:
            h = int(hashlib.md5(resposta.encode()).hexdigest(), 16)
            if h % 2 == 0:
                emoji_final = f" {emoji_opcoes[h % len(emoji_opcoes)]}"
        
        boas_vindas_variacoes = [
            f"Seja muito bem-vindo(a) à {nome_provedor}",
            f"É um prazer recebê-lo na {nome_provedor}",
            f"Bem-vindo(a) à {nome_provedor}",
            f"Que bom ter você aqui na {nome_provedor}"
        ]
        
        pergunta_variacoes = [
            "Você já é nosso cliente ou está querendo conhecer nossos planos de internet ultra rápida?",
            "Você já faz parte da nossa família ou quer saber mais sobre nossos planos?",
            "Você já é cliente ou gostaria de conhecer nossos serviços?",
            "Você já é nosso cliente ou está interessado em nossos planos?"
        ]
        
        h = int(hashlib.md5(nome_provedor.encode()).hexdigest(), 16)
        bv = boas_vindas_variacoes[h % len(boas_vindas_variacoes)]
        pq = pergunta_variacoes[h % len(pergunta_variacoes)]
        
        return f"{saudacao}! {bv}{emoji_final}\n\n{pq}"

    def _dividir_primeira_mensagem(self, mensagem: str) -> list:
        """Divide a primeira mensagem em partes menores para envio com delay"""
        if not mensagem: return []
        if len(mensagem.strip()) <= 12: return [mensagem.strip()]
        if " | " in mensagem:
            return [p.strip() for p in mensagem.split(" | ") if p.strip()]
        return [mensagem]

    def _verificar_horario_atendimento(self, provedor) -> Dict[str, Any]:
        """
        Verifica se está dentro do horário de atendimento e calcula próximo horário disponível.
        """
        try:
            if not provedor.horarios_atendimento:
                return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}
            
            horarios = json.loads(provedor.horarios_atendimento) if isinstance(provedor.horarios_atendimento, str) else provedor.horarios_atendimento
            
            if not horarios or not isinstance(horarios, list):
                return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}
            
            now = timezone.now()
            dia_atual_num = now.weekday()
            dias_semana = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']
            dia_atual_nome = dias_semana[dia_atual_num]
            
            horario_hoje = next((d for d in horarios if d.get('dia') == dia_atual_nome), None)
            
            if not horario_hoje or not horario_hoje.get('periodos'):
                for i in range(1, 8):
                    prox_dia = (dia_atual_num + i) % 7
                    prox_nome = dias_semana[prox_dia]
                    dia_info = next((d for d in horarios if d.get('dia') == prox_nome and d.get('periodos')), None)
                    if dia_info:
                        inicio = dia_info['periodos'][0].get('inicio', '')
                        return {
                            'dentro_horario': False,
                            'proximo_horario': f"{prox_nome} as {inicio}",
                            'mensagem': f"Você será atendido na {prox_nome} as {inicio}"
                        }
                return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}
            
            periodos = horario_hoje.get('periodos', [])
            hora_atual_minutos = now.hour * 60 + now.minute
            
            for p in periodos:
                try:
                    h_ini, m_ini = map(int, p.get('inicio', '00:00').split(':'))
                    h_fim, m_fim = map(int, p.get('fim', '00:00').split(':'))
                    if h_ini * 60 + m_ini <= hora_atual_minutos <= h_fim * 60 + m_fim:
                        return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}
                except: continue
            
            # Se não está em nenhum período de hoje, ver se tem algum depois de agora
            for p in periodos:
                try:
                    h_ini, m_ini = map(int, p.get('inicio', '00:00').split(':'))
                    if hora_atual_minutos < h_ini * 60 + m_ini:
                        return {
                            'dentro_horario': False,
                            'proximo_horario': f"Hoje as {p.get('inicio')}",
                            'mensagem': f"Você será atendido hoje as {p.get('inicio')}"
                        }
                except: continue
                
            return {'dentro_horario': False, 'proximo_horario': "no próximo dia útil", 'mensagem': "Fora do horário de atendimento."}
            
        except Exception:
            return {'dentro_horario': True, 'proximo_horario': None, 'mensagem': None}
