import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldAlert, Copy, Check, RefreshCw, ExternalLink, CreditCard } from 'lucide-react';

const BlockedScreen = ({ onLogout }) => {
    const [loading, setLoading] = useState(true);
    const [statusData, setStatusData] = useState(null);
    const [copied, setCopied] = useState(false);
    const [checking, setChecking] = useState(false);

    const fetchStatus = async () => {
        setChecking(true);
        try {
            const response = await axios.get('/api/provedores/status_pagamento/');
            setStatusData(response.data);
            if (!response.data.blocked) {
                window.location.reload(); // Desbloqueou!
            }
        } catch (error) {
            console.error('Erro ao buscar status de pagamento:', error);
        } finally {
            setLoading(false);
            setChecking(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    const { payment, pix, reason } = statusData || {};

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
            <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                {/* Header Alerta */}
                <div className="bg-gradient-to-r from-red-600 to-orange-600 p-8 text-white relative">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <ShieldAlert size={120} />
                    </div>
                    <div className="relative z-10 flex items-center gap-4">
                        <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                            <ShieldAlert size={32} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight">Acesso Suspenso</h1>
                            <p className="text-white/80 font-medium">Identificamos uma pendência financeira em sua assinatura.</p>
                        </div>
                    </div>
                </div>

                <div className="p-8">
                    <div className="grid md:grid-cols-2 gap-8">
                        {/* Coluna 1: Info e QR Code */}
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Detalhes da Pendência</h3>
                                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                                    <div className="flex justify-between mb-1">
                                        <span className="text-slate-600">Valor:</span>
                                        <span className="font-bold text-slate-900 text-lg">
                                            R$ {parseFloat(payment?.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Vencimento:</span>
                                        <span className="font-medium text-red-600">
                                            {payment?.dueDate ? new Date(payment.dueDate).toLocaleDateString('pt-BR') : 'N/A'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {pix?.encodedImage ? (
                                <div className="flex flex-col items-center">
                                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 w-full">Pague via PIX</h3>
                                    <div className="bg-white p-3 rounded-3xl border-2 border-slate-100 shadow-sm">
                                        <img 
                                            src={`data:image/png;base64,${pix.encodedImage}`} 
                                            alt="QR Code Pix" 
                                            className="w-48 h-48"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3 text-center">Escaneie o QR Code com o app do seu banco</p>
                                </div>
                            ) : (
                                <div className="h-48 flex items-center justify-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                                    <p className="text-slate-400 text-sm">QR Code indisponível no momento</p>
                                </div>
                            )}
                        </div>

                        {/* Coluna 2: Ações */}
                        <div className="flex flex-col justify-between">
                            <div className="space-y-6">
                                {pix?.payload && (
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Pix Copia e Cola</h3>
                                        <button 
                                            onClick={() => copyToClipboard(pix.payload)}
                                            className="w-full group relative flex items-center gap-3 p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl transition-all active:scale-95 overflow-hidden"
                                        >
                                            <div className="flex-1 text-left truncate font-mono text-sm text-slate-600">
                                                {pix.payload}
                                            </div>
                                            <div className="bg-white p-2 rounded-lg shadow-sm group-hover:bg-primary group-hover:text-white transition-colors">
                                                {copied ? <Check size={18} /> : <Copy size={18} />}
                                            </div>
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Outras Opções</h3>
                                    <a 
                                        href={payment?.invoiceUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl hover:border-primary transition-all group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/10 p-2 rounded-xl text-primary">
                                                <CreditCard size={20} />
                                            </div>
                                            <span className="font-semibold text-slate-700">Ver Fatura Completa</span>
                                        </div>
                                        <ExternalLink size={18} className="text-slate-400 group-hover:text-primary" />
                                    </a>
                                </div>
                            </div>

                            <div className="mt-8 space-y-3">
                                <button 
                                    onClick={fetchStatus}
                                    disabled={checking}
                                    className="w-full flex items-center justify-center gap-2 py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-bold transition-all disabled:opacity-50"
                                >
                                    <RefreshCw size={20} className={checking ? 'animate-spin' : ''} />
                                    {checking ? 'Verificando...' : 'Já realizei o pagamento'}
                                </button>
                                <button 
                                    onClick={onLogout}
                                    className="w-full py-3 text-slate-500 hover:text-red-600 font-medium transition-colors"
                                >
                                    Sair da conta
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 italic text-center text-slate-400 text-sm">
                        "O seu acesso será restabelecido automaticamente em poucos segundos após a confirmação do pagamento."
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BlockedScreen;
