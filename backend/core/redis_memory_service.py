"""
Serviço centralizado de memória Redis para conversas e provedores.
Mantém isolamento estrito por provedor, canal, conversa e telefone.

UNIFICADO: Um único registro por (provedor, conversa, canal, telefone).
Chave: ai:memory:{provedor_id}:{channel}:{conversation_id}:{phone}
       └─ provedor X ─┘
Valor: JSON com "state" (estado do fluxo) e "context" (histórico de mensagens).
Assim a IA faz uma única leitura para obter estado + histórico daquela conversa.

ISOLAMENTO POR PROVEDOR:
- Cada provedor tem seu próprio namespace no Redis (primeiro segmento da chave).
- Provedor 1: ai:memory:1:whatsapp:36:556392484773
- Provedor 2: ai:memory:2:whatsapp:36:556392484773
- Provedor X: ai:memory:X:whatsapp:36:556392484773
- A IA de um provedor NUNCA acessa dados de outro provedor.
- Novos provedores são automaticamente isolados ao usar seu provedor_id único.
"""

import json
import logging
from typing import Dict, Any, Optional, List
from datetime import timezone as dt_timezone
import redis
import redis.asyncio as aioredis
from django.conf import settings
from django.utils import timezone
import asyncio

logger = logging.getLogger(__name__)

# Limite de mensagens no contexto (últimas N)
CONTEXT_MAX_MESSAGES = 15

def normalize_phone_number(phone: str) -> str:
    """Normaliza número de telefone para formato padrão E.164 (apenas números)."""
    if not phone:
        return "unknown"
    phone_str = str(phone)
    if "@" in phone_str:
        phone_str = phone_str.split("@")[0]
    cleaned = "".join(filter(str.isdigit, phone_str))
    return cleaned or "unknown"

def _default_state(updated_at: str) -> Dict[str, Any]:
    return {"flow": "NONE", "step": "INICIAL", "updated_at": updated_at}

class RedisConversationMemoryService:
    def __init__(self):
        self.redis_host = settings.REDIS_HOST
        self.redis_port = settings.REDIS_PORT
        self.redis_password = settings.REDIS_PASSWORD
        self.redis_db = settings.REDIS_DB
        self.redis_username = getattr(settings, 'REDIS_USERNAME', None)

        if self.redis_username:
            self.redis_url = f'redis://{self.redis_username}:{self.redis_password}@{self.redis_host}:{self.redis_port}/{self.redis_db}'
        else:
            self.redis_url = f'redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/{self.redis_db}'

        self._redis_by_loop: Dict[int, aioredis.Redis] = {}
        
        # TTL do registro unificado (uma chave por provedor+conversa)
        self.memory_ttl = 30 * 60   # 30 minutos
        self.lock_ttl = 30          # 30 segundos (concorrência)

    def normalize_channel(self, channel: str) -> str:
        """Enforça canal padrão (wa -> whatsapp, tg -> telegram)."""
        if not channel: return "whatsapp"
        ch = str(channel).lower().strip()
        if ch in ["wa", "whatsapp"]: return "whatsapp"
        if ch in ["tg", "telegram"]: return "telegram"
        return ch

    def _get_memory_key(self, provedor_id: int, channel: str, conversation_id: int, phone: str) -> str:
        """
        Gera chave única por provedor + conversa + canal + telefone.
        Um único dado: state + context juntos.
        
        Estrutura: ai:memory:{provedor_id}:{channel}:{conversation_id}:{phone}
                   └─ provedor X (isolamento garantido) ─┘
        
        Exemplos:
        - Provedor 1: ai:memory:1:whatsapp:36:556392484773
        - Provedor 2: ai:memory:2:whatsapp:36:556392484773
        - Provedor X: ai:memory:X:whatsapp:36:556392484773
        
        Cada provedor tem seu próprio namespace. Novos provedores são automaticamente
        isolados ao usar seu provedor_id único na chave.
        """
        ch_norm = self.normalize_channel(channel)
        ph_norm = normalize_phone_number(phone)
        return f"ai:memory:{provedor_id}:{ch_norm}:{conversation_id}:{ph_norm}"

    def _get_key(self, type_name: str, provedor_id: int, channel: str, conversation_id: int, phone: str) -> str:
        """Compatibilidade (lock ainda usa type)."""
        ch_norm = self.normalize_channel(channel)
        ph_norm = normalize_phone_number(phone)
        return f"ai:{type_name}:{provedor_id}:{ch_norm}:{conversation_id}:{ph_norm}"

    def _now_iso(self) -> str:
        return timezone.now().astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")

    async def get_redis_connection(self):
        try:
            loop = asyncio.get_running_loop()
            loop_id = id(loop)
        except Exception:
            loop_id = None

        if loop_id is not None and loop_id in self._redis_by_loop:
            return self._redis_by_loop[loop_id]

        client = aioredis.from_url(
            self.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=10,
            retry_on_timeout=True
        )
        if loop_id is not None:
            self._redis_by_loop[loop_id] = client
        return client

    def get_redis_sync(self):
        return redis.Redis(
            host=self.redis_host, port=self.redis_port, db=self.redis_db,
            username=self.redis_username, password=self.redis_password,
            decode_responses=True, socket_timeout=10
        )

    # --- MEMÓRIA UNIFICADA (state + context em uma chave) ---
    def _parse_memory(self, raw: Optional[str]) -> Dict[str, Any]:
        """Parse do JSON da chave ai:memory. Retorna { state, context } com defaults."""
        now = self._now_iso()
        if not raw:
            return {"state": _default_state(now), "context": []}
        try:
            data = json.loads(raw)
            state = data.get("state") or _default_state(now)
            context = data.get("context")
            if not isinstance(context, list):
                context = []
            return {"state": state, "context": context}
        except (json.JSONDecodeError, TypeError):
            return {"state": _default_state(now), "context": []}

    async def get_ai_memory(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        """
        Uma única leitura: estado + histórico da conversa (provedor X, conversa X).
        A IA usa isso para buscar só o que precisa, sem criar vários acessos.
        
        ISOLAMENTO: Esta função só retorna dados do provedor_id especificado.
        A chave Redis inclui o provedor_id como primeiro segmento, garantindo
        que provedores diferentes nunca compartilhem dados.
        
        Args:
            provedor_id: ID do provedor (garante isolamento - cada provedor tem seu namespace)
            conversation_id: ID da conversa
            channel: Canal (whatsapp, telegram, etc.)
            phone: Telefone do contato
            
        Returns:
            Dict com "state" (estado do fluxo) e "context" (histórico de mensagens)
        """
        redis_conn = await self.get_redis_connection()
        key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        raw = await redis_conn.get(key)
        return self._parse_memory(raw)

    def get_ai_memory_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        """Versão síncrona de get_ai_memory."""
        redis_conn = self.get_redis_sync()
        key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        raw = redis_conn.get(key)
        return self._parse_memory(raw)

    async def _set_memory(self, provedor_id: int, conversation_id: int, channel: str, phone: str, state: Dict[str, Any], context: List[Dict[str, Any]]):
        """Persiste o registro unificado (state + context) com TTL."""
        redis_conn = await self.get_redis_connection()
        key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        state["updated_at"] = self._now_iso()
        payload = json.dumps({"state": state, "context": context[-CONTEXT_MAX_MESSAGES:]}, ensure_ascii=False)
        await redis_conn.setex(key, self.memory_ttl, payload)

    def _set_memory_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str, state: Dict[str, Any], context: List[Dict[str, Any]]):
        redis_conn = self.get_redis_sync()
        key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        state["updated_at"] = self._now_iso()
        payload = json.dumps({"state": state, "context": context[-CONTEXT_MAX_MESSAGES:]}, ensure_ascii=False)
        redis_conn.setex(key, self.memory_ttl, payload)

    # --- MIGRAÇÃO ---
    async def migrate_unknown_phone(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        """Migra o registro unificado de 'unknown' para o telefone identificado."""
        if not phone or phone == "unknown":
            return
        redis_conn = await self.get_redis_connection()
        ch_norm = self.normalize_channel(channel)
        unknown_key = f"ai:memory:{provedor_id}:{ch_norm}:{conversation_id}:unknown"
        target_key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        if await redis_conn.exists(unknown_key):
            if not await redis_conn.exists(target_key):
                await redis_conn.rename(unknown_key, target_key)
                logger.info(f"🔄 Migrado memória: {unknown_key} -> {target_key}")
            else:
                await redis_conn.delete(unknown_key)

    # --- ESTADO (STATE) — leem/escrevem no registro unificado ---
    async def get_ai_state(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        """Estado do fluxo. Isolado por provedor e conversa (um único dado)."""
        mem = await self.get_ai_memory(provedor_id, conversation_id, channel, phone)
        return mem["state"]

    def get_ai_state_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        """Versão síncrona para obter estado do fluxo."""
        mem = self.get_ai_memory_sync(provedor_id, conversation_id, channel, phone)
        return mem["state"]

    async def set_ai_state(self, provedor_id: int, conversation_id: int, data: Dict[str, Any], channel: str, phone: str):
        mem = await self.get_ai_memory(provedor_id, conversation_id, channel, phone)
        mem["state"] = {**data, "updated_at": self._now_iso()}
        await self._set_memory(provedor_id, conversation_id, channel, phone, mem["state"], mem["context"])

    async def update_ai_state(self, provedor_id: int, conversation_id: int, updates: Dict[str, Any], channel: str, phone: str):
        mem = await self.get_ai_memory(provedor_id, conversation_id, channel, phone)
        mem["state"].update(updates or {})
        await self._set_memory(provedor_id, conversation_id, channel, phone, mem["state"], mem["context"])

    def update_ai_state_sync(self, provedor_id: int, conversation_id: int, updates: Dict[str, Any], channel: str, phone: str):
        mem = self.get_ai_memory_sync(provedor_id, conversation_id, channel, phone)
        mem["state"].update(updates or {})
        self._set_memory_sync(provedor_id, conversation_id, channel, phone, mem["state"], mem["context"])

    # --- CONTEXTO (CONTEXT) — no mesmo registro unificado ---
    async def add_ai_context(self, provedor_id: int, conversation_id: int, role: str, content: str, channel: str, phone: str):
        mem = await self.get_ai_memory(provedor_id, conversation_id, channel, phone)
        msg = {"role": role, "content": content, "timestamp": self._now_iso()}
        mem["context"].append(msg)
        mem["context"] = mem["context"][-CONTEXT_MAX_MESSAGES:]
        await self._set_memory(provedor_id, conversation_id, channel, phone, mem["state"], mem["context"])

    async def get_ai_context(self, provedor_id: int, conversation_id: int, channel: str, phone: str, limit: int = 10) -> List[Dict[str, Any]]:
        mem = await self.get_ai_memory(provedor_id, conversation_id, channel, phone)
        ctx = mem.get("context") or []
        return ctx[-limit:] if limit else ctx

    # --- LOCK ---
    async def acquire_lock(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> bool:
        redis_conn = await self.get_redis_connection()
        key = self._get_key("lock", provedor_id, channel, conversation_id, phone)
        return await redis_conn.set(key, "1", ex=self.lock_ttl, nx=True)

    async def release_lock(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        redis_conn = await self.get_redis_connection()
        key = self._get_key("lock", provedor_id, channel, conversation_id, phone)
        await redis_conn.delete(key)

    # --- LIMPEZA ---
    async def clear_memory(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        redis_conn = await self.get_redis_connection()
        mem_key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        lock_key = self._get_key("lock", provedor_id, channel, conversation_id, phone)
        await redis_conn.delete(mem_key)
        await redis_conn.delete(lock_key)
        ch_norm = self.normalize_channel(channel)
        await redis_conn.delete(f"ai:memory:{provedor_id}:{ch_norm}:{conversation_id}:unknown")
        await redis_conn.delete(f"ai:lock:{provedor_id}:{ch_norm}:{conversation_id}:unknown")

    def clear_memory_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        redis_conn = self.get_redis_sync()
        mem_key = self._get_memory_key(provedor_id, channel, conversation_id, phone)
        lock_key = self._get_key("lock", provedor_id, channel, conversation_id, phone)
        redis_conn.delete(mem_key)
        redis_conn.delete(lock_key)

    # --- COMPATIBILIDADE ---
    def add_message_to_conversation_sync(self, provedor_id: int, conversation_id: int, sender: str, content: str, channel: str, phone: str, **kwargs):
        role = "user" if sender == "customer" else "assistant"
        mem = self.get_ai_memory_sync(provedor_id, conversation_id, channel, phone)
        msg = {"role": role, "content": content, "timestamp": self._now_iso()}
        mem["context"].append(msg)
        mem["context"] = mem["context"][-CONTEXT_MAX_MESSAGES:]
        self._set_memory_sync(provedor_id, conversation_id, channel, phone, mem["state"], mem["context"])

    async def add_message_to_conversation(self, provedor_id: int, conversation_id: int, sender: str, content: str, channel: str, phone: str, **kwargs):
        role = "user" if sender == "customer" else "assistant"
        await self.add_ai_context(provedor_id, conversation_id, role, content, channel, phone)

    # ⚠️ MÉTODOS LEGADOS REMOVIDOS POR SEGURANÇA
    # Os métodos get_conversation_memory e get_conversation_memory_sync foram removidos
    # para evitar vazamento de dados entre conversas do mesmo provedor.
    # Agora sempre usamos o novo padrão com isolamento por provedor:conversation:phone
    
    def clear_conversation_memory_sync(self, provedor_id: int, conversation_id: int, channel: str = "whatsapp", phone: str = "unknown"):
        """Limpa memória de uma conversa específica com isolamento completo."""
        self.clear_memory_sync(provedor_id, conversation_id, channel, phone)

# Instância global
redis_memory_service = RedisConversationMemoryService()
