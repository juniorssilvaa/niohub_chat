"""
Serviço centralizado de memória Redis para conversas e provedores.
Mantém isolamento estrito por provedor, canal, conversa e telefone.
"""

import json
import logging
import hashlib
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone as dt_timezone
import redis
import redis.asyncio as aioredis
from django.conf import settings
from django.utils import timezone
import asyncio

logger = logging.getLogger(__name__)

def normalize_phone_number(phone: str) -> str:
    """Normaliza número de telefone para formato padrão E.164 (apenas números)."""
    if not phone:
        return "unknown"
    phone_str = str(phone)
    if "@" in phone_str:
        phone_str = phone_str.split("@")[0]
    cleaned = "".join(filter(str.isdigit, phone_str))
    return cleaned or "unknown"

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
        
        # TTLs (em segundos)
        self.context_ttl = 15 * 60  # 15 minutos (memória imediata)
        self.state_ttl = 30 * 60    # 30 minutos (estado do fluxo)
        self.lock_ttl = 30          # 30 segundos (concorrência)
        self.default_ttl = 17 * 60 * 60 # 17 horas (legado/geral)

    def normalize_channel(self, channel: str) -> str:
        """Enforça canal padrão (wa -> whatsapp, tg -> telegram)."""
        if not channel: return "whatsapp"
        ch = str(channel).lower().strip()
        if ch in ["wa", "whatsapp"]: return "whatsapp"
        if ch in ["tg", "telegram"]: return "telegram"
        return ch

    def _get_key(self, type_name: str, provedor_id: int, channel: str, conversation_id: int, phone: str) -> str:
        """
        Gera a chave única e imutável para a memória.
        Padrão: ai:{type}:{provedor_id}:{channel}:{conversation_id}:{phone}
        """
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

    # --- MIGRAÇÃO ---
    async def migrate_unknown_phone(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        """Migra dados de 'unknown' para o telefone identificado."""
        if not phone or phone == "unknown": return
        
        redis_conn = await self.get_redis_connection()
        ch_norm = self.normalize_channel(channel)
        
        for type_name in ["state", "context"]:
            unknown_key = f"ai:{type_name}:{provedor_id}:{ch_norm}:{conversation_id}:unknown"
            target_key = self._get_key(type_name, provedor_id, channel, conversation_id, phone)
            
            if await redis_conn.exists(unknown_key):
                if not await redis_conn.exists(target_key):
                    await redis_conn.rename(unknown_key, target_key)
                    logger.info(f"🔄 Migrado {type_name}: {unknown_key} -> {target_key}")
                else:
                    await redis_conn.delete(unknown_key)

    # --- ESTADO (STATE) ---
    async def get_ai_state(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        redis_conn = await self.get_redis_connection()
        key = self._get_key("state", provedor_id, channel, conversation_id, phone)
        data = await redis_conn.get(key)
        if data:
            return json.loads(data)
        
        # Fallback legado durante migração de versão
        old_pattern = f"ai:memory:{provedor_id}:{conversation_id}"
        old_data = await redis_conn.get(old_pattern)
        if old_data:
            state = json.loads(old_data)
            await self.set_ai_state(provedor_id, conversation_id, state, channel, phone)
            return state
            
        return {"flow": "NONE", "step": "INICIAL", "updated_at": self._now_iso()}

    def get_ai_state_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str) -> Dict[str, Any]:
        """Versão síncrona para obter estado do fluxo."""
        redis_conn = self.get_redis_sync()
        key = self._get_key("state", provedor_id, channel, conversation_id, phone)
        data = redis_conn.get(key)
        if data:
            return json.loads(data)
        
        # Fallback para o método legado já existente na classe
        return self.get_conversation_memory_sync(provedor_id, conversation_id, channel, phone)

    async def set_ai_state(self, provedor_id: int, conversation_id: int, data: Dict[str, Any], channel: str, phone: str):
        redis_conn = await self.get_redis_connection()
        key = self._get_key("state", provedor_id, channel, conversation_id, phone)
        data["updated_at"] = self._now_iso()
        await redis_conn.setex(key, self.state_ttl, json.dumps(data, ensure_ascii=False))

    async def update_ai_state(self, provedor_id: int, conversation_id: int, updates: Dict[str, Any], channel: str, phone: str):
        state = await self.get_ai_state(provedor_id, conversation_id, channel, phone)
        state.update(updates or {})
        await self.set_ai_state(provedor_id, conversation_id, state, channel, phone)

    def update_ai_state_sync(self, provedor_id: int, conversation_id: int, updates: Dict[str, Any], channel: str, phone: str):
        redis_conn = self.get_redis_sync()
        key = self._get_key("state", provedor_id, channel, conversation_id, phone)
        
        data = redis_conn.get(key)
        state = json.loads(data) if data else {"flow": "NONE", "step": "INICIAL"}
        state.update(updates or {})
        state["updated_at"] = self._now_iso()
        redis_conn.setex(key, self.state_ttl, json.dumps(state, ensure_ascii=False))

    # --- CONTEXTO (CONTEXT) ---
    async def add_ai_context(self, provedor_id: int, conversation_id: int, role: str, content: str, channel: str, phone: str):
        redis_conn = await self.get_redis_connection()
        key = self._get_key("context", provedor_id, channel, conversation_id, phone)
        msg = {"role": role, "content": content, "timestamp": self._now_iso()}
        await redis_conn.rpush(key, json.dumps(msg, ensure_ascii=False))
        await redis_conn.ltrim(key, -15, -1)
        await redis_conn.expire(key, self.context_ttl)

    async def get_ai_context(self, provedor_id: int, conversation_id: int, channel: str, phone: str, limit: int = 10) -> List[Dict[str, Any]]:
        redis_conn = await self.get_redis_connection()
        key = self._get_key("context", provedor_id, channel, conversation_id, phone)
        msgs = await redis_conn.lrange(key, -limit, -1)
        return [json.loads(m) for m in msgs] if msgs else []

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
        for type_name in ["state", "context", "lock"]:
            key = self._get_key(type_name, provedor_id, channel, conversation_id, phone)
            await redis_conn.delete(key)
        
        # Limpar também possíveis duplicatas unknown
        ch_norm = self.normalize_channel(channel)
        for type_name in ["state", "context", "lock"]:
            await redis_conn.delete(f"ai:{type_name}:{provedor_id}:{ch_norm}:{conversation_id}:unknown")

    def clear_memory_sync(self, provedor_id: int, conversation_id: int, channel: str, phone: str):
        redis_conn = self.get_redis_sync()
        for type_name in ["state", "context", "lock"]:
            key = self._get_key(type_name, provedor_id, channel, conversation_id, phone)
            redis_conn.delete(key)

    # --- COMPATIBILIDADE ---
    def add_message_to_conversation_sync(self, provedor_id: int, conversation_id: int, sender: str, content: str, channel: str, phone: str, **kwargs):
        role = "user" if sender == "customer" else "assistant"
        redis_conn = self.get_redis_sync()
        key = self._get_key("context", provedor_id, channel, conversation_id, phone)
        msg = {"role": role, "content": content, "timestamp": self._now_iso()}
        redis_conn.rpush(key, json.dumps(msg, ensure_ascii=False))
        redis_conn.ltrim(key, -15, -1)
        redis_conn.expire(key, self.context_ttl)

    async def add_message_to_conversation(self, provedor_id: int, conversation_id: int, sender: str, content: str, channel: str, phone: str, **kwargs):
        role = "user" if sender == "customer" else "assistant"
        await self.add_ai_context(provedor_id, conversation_id, role, content, channel, phone)

    # Métodos legados que ainda podem ser chamados
    async def get_conversation_memory(self, provedor_id: int, conversation_id: int):
        return await self.get_ai_state(provedor_id, conversation_id, "whatsapp", "unknown")

    def get_conversation_memory_sync(self, provedor_id: int, conversation_id: int, channel: str = "whatsapp", phone: str = "unknown"):
        redis_conn = self.get_redis_sync()
        key = self._get_key("state", provedor_id, channel, conversation_id, phone)
        data = redis_conn.get(key)
        return json.loads(data) if data else {"flow": "NONE", "step": "INICIAL"}

    def clear_conversation_memory_sync(self, provedor_id: int, conversation_id: int, channel: str = "whatsapp", phone: str = "unknown"):
        self.clear_memory_sync(provedor_id, conversation_id, channel, phone)

# Instância global
redis_memory_service = RedisConversationMemoryService()
