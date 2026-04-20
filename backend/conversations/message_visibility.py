"""
Visibilidade de mensagens para atendentes: após voltar ao fluxo do bot,
histórico anterior ao marco agent_chat_visible_from não é listado no painel
(exceto com for_audit=1 por admin/superadmin na aba de auditoria).
"""
from django.utils import timezone
from django.utils.dateparse import parse_datetime


def mark_conversation_new_bot_session(conversation):
    """
    Reabertura para o bot na MESMA conversa: marca corte para o painel e zera
    chatbot_memory (evita IA repetir confirmação de transferência / fila do ciclo anterior).
    """
    if conversation is None:
        return
    attrs = dict(conversation.additional_attributes or {})
    attrs["agent_chat_visible_from"] = timezone.now().isoformat()
    attrs.pop("chatbot_memory", None)
    for stale in ("assigned_team", "assigned_user", "transfer_decision", "pending_transfer"):
        attrs.pop(stale, None)
    conversation.additional_attributes = attrs


def apply_agent_message_visibility_filter(queryset, conversation, request):
    """
    Restringe o queryset de mensagens ao período visível para o painel.
    """
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return queryset

    for_audit = request.query_params.get("for_audit") in ("1", "true", "True", "yes")
    if for_audit and getattr(user, "user_type", None) in ("superadmin", "admin"):
        return queryset

    attrs = getattr(conversation, "additional_attributes", None) or {}
    cutoff_iso = attrs.get("agent_chat_visible_from")
    if not cutoff_iso:
        return queryset

    dt = parse_datetime(str(cutoff_iso))
    if not dt:
        return queryset
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())

    return queryset.filter(created_at__gte=dt)
