import React, { useState, useEffect } from 'react';
import { CheckCircle, Bell } from 'lucide-react';
import axios from 'axios';

const NotificationModal = ({ isOpen, onClose, notification, onMarkAsRead }) => {
  const [isLoading, setIsLoading] = useState(false);

  // Marcar como visualizada
  const handleConfirmRead = async () => {
    if (!notification) return;

    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      await axios.patch(`/api/mensagens-sistema/${notification.id}/marcar-visualizada/`, {}, {
        headers: { Authorization: `Token ${token}` }
      });

      // Chamar callback para atualizar estado
      if (onMarkAsRead) {
        onMarkAsRead(notification.id);
      }

      // Fechar modal
      onClose();
    } catch (err) {
      console.error('Erro ao marcar como visualizada:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fechar modal sem marcar como visualizada
  // A mensagem continuará aparecendo a cada 15 minutos até ser confirmada
  const handleClose = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (onClose) {
      onClose();
    }
  };

  // Prevenir fechamento com ESC - só fecha com botão "Fechar" ou "Confirmar Leitura"
  useEffect(() => {
    if (isOpen) {
      // Prevenir scroll do body
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !notification) return null;

  return (
    <>
      {/* Overlay com Glassmorphism Refinado */}
      <div
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300"
      >
        {/* Modal Premium */}
        <div
          className="bg-[#27303D] border border-[#3A4352] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col ring-1 ring-white/5 animate-in zoom-in-95 duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Elegante baseado no sistema */}
          <div className="relative overflow-hidden p-6 border-b border-[#3A4352]">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-transparent to-transparent" />
            
            <div className="relative flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shadow-inner">
                <Bell className="w-6 h-6 animate-bounce" style={{ animationDuration: '3s' }} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Nova Notificação do Sistema
                </h2>
                <p className="text-sm text-blue-400/80 font-medium">
                  Informação importante para o seu provedor
                </p>
              </div>
            </div>
          </div>

          {/* Conteúdo com Tipografia Refinada */}
          <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
            {/* Seção de Assunto */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] ml-1">
                Assunto do Aviso
              </label>
              <div className="bg-[#1f2630]/50 backdrop-blur-sm rounded-xl p-4 border border-[#3A4352] ring-1 ring-inset ring-white/5">
                <p className="text-lg font-semibold text-slate-100 leading-tight">
                  {notification.assunto}
                </p>
              </div>
            </div>

            {/* Seção de Mensagem */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-[#94A3B8] ml-1">
                Conteúdo da Mensagem
              </label>
              <div className="bg-[#192533]/30 rounded-xl p-5 border border-[#3A4352] shadow-inner">
                <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {notification.mensagem}
                </p>
              </div>
            </div>

            {/* Meta-informações em grid */}
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="bg-slate-800/30 p-3 rounded-lg border border-white/5 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-500">Enviado em</span>
                <span className="text-sm text-slate-300">
                  {new Date(notification.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <div className="bg-slate-800/30 p-3 rounded-lg border border-white/5 flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-500">Tipo de Alerta</span>
                <span className="text-sm text-blue-400 capitalize bg-blue-400/10 px-2 py-0.5 rounded-md self-start mt-1">
                  {notification.tipo}
                </span>
              </div>
            </div>
          </div>

          {/* Footer com Ações Premium */}
          <div className="p-6 bg-[#1f2630]/50 border-t border-[#3A4352] flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2.5 rounded-xl border border-[#3A4352] text-slate-400 hover:text-white hover:bg-white/5 hover:border-white/20 transition-all duration-200 font-medium text-sm"
            >
              Lembrar mais tarde
            </button>
            <button
              type="button"
              onClick={handleConfirmRead}
              disabled={isLoading}
              className="group relative px-7 py-2.5 rounded-xl bg-blue-600 font-bold text-sm text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] hover:bg-blue-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />
              
              <div className="relative flex items-center gap-2">
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 transition-transform group-hover:scale-110" />
                    <span>Confirmar Recebimento</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </>
  );
};

export default NotificationModal; 