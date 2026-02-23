import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bot, Plus, Share2, Play, MousePointer2, Save,
    ArrowLeft, Settings, Trash2, MessageSquare,
    Zap, GitBranch, Database, Globe, X, Check,
    GripVertical, Info, Send, User, ChevronRight, List,
    Eye, EyeOff
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const NODE_TYPES = {
    start: { label: 'Início', color: 'bg-emerald-500', icon: Play },
    message: { label: 'Mensagem', color: 'bg-blue-500', icon: MessageSquare },
    condition: { label: 'Condição', color: 'bg-amber-500', icon: GitBranch },
    sgp: { label: 'Consulta SGP', color: 'bg-purple-500', icon: Database },
    api: { label: 'Integração API', color: 'bg-indigo-500', icon: Globe },
    menu: { label: 'Lista Interativa (WhatsApp)', color: 'bg-emerald-600', icon: List },
};

const ChatbotBuilder = () => {
    const { t } = useLanguage();
    const { provedorId } = useParams();
    const [loading, setLoading] = useState(false);
    const [currentFlow, setCurrentFlow] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const canvasRef = useRef(null);

    // Flow State
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);

    // Connection State
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionSource, setConnectionSource] = useState(null);
    const [connectionSourceHandle, setConnectionSourceHandle] = useState(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // Simulator State
    const [showSimulator, setShowSimulator] = useState(false);
    const [simMessages, setSimMessages] = useState([]);
    const [currentNodeId, setCurrentNodeId] = useState(null);

    // Canvas & Context Menu State
    const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, type: null, targetId: null });

    useEffect(() => {
        const fetchFlows = async () => {
            console.log("Iniciando fetchFlows para provedor:", provedorId);
            setLoading(true);
            try {
                const response = await axios.get(`/api/chatbot-flows/?provedor=${provedorId}`);
                console.log("Resposta fetchFlows:", response.data);

                // Handle both direct array and paginated results
                const flows = Array.isArray(response.data) ? response.data : (response.data.results || []);

                if (flows.length > 0) {
                    const flow = flows[0];
                    console.log("Fluxo carregado:", flow.id, "Nodes:", flow.nodes?.length);
                    setCurrentFlow(flow);
                    setNodes(flow.nodes || []);
                    setEdges(flow.edges || []);
                } else {
                    console.log("Nenhum fluxo encontrado para este provedor.");
                }
            } catch (error) {
                console.error('Erro ao buscar fluxos:', error);
            } finally {
                setLoading(false);
            }
        };

        if (provedorId) fetchFlows();
    }, [provedorId]);

    const handleCreateFlow = async () => {
        setLoading(true);
        try {
            // First check if one already exists to avoid duplication
            const existing = await axios.get(`/api/chatbot-flows/?provedor=${provedorId}`);
            const flows = Array.isArray(existing.data) ? existing.data : (existing.data.results || []);

            if (flows.length > 0) {
                const flow = flows[0];
                setCurrentFlow(flow);
                setNodes(flow.nodes || []);
                setEdges(flow.edges || []);
                setLoading(false);
                return;
            }

            const initialNodes = [{
                id: 'node_' + Date.now(),
                type: 'start',
                position: { x: 250, y: 150 },
                data: { label: 'Início do Chatbot' }
            }];
            const response = await axios.post('/api/chatbot-flows/', {
                name: 'Novo Fluxo de Chatbot',
                provedor: provedorId,
                nodes: initialNodes,
                edges: []
            });
            console.log("Fluxo criado com ID:", response.data.id);
            setCurrentFlow(response.data);
            setNodes(initialNodes);
            setEdges([]);
        } catch (error) {
            console.error('Erro ao criar fluxo:', error);
            alert('Erro ao criar fluxo de chatbot.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveFlow = async () => {
        if (!currentFlow) return;
        setIsSaving(true);
        try {
            console.log("Salvando fluxo ID:", currentFlow.id, "Nodes:", nodes.length, "Edges:", edges.length);
            console.log("Edges a salvar:", JSON.stringify(edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })), null, 2));
            const response = await axios.put(`/api/chatbot-flows/${currentFlow.id}/`, {
                id: currentFlow.id,
                name: currentFlow.name,
                provedor: currentFlow.provedor,
                nodes: nodes,
                edges: edges
            });
            setCurrentFlow(response.data);
            setNodes(response.data.nodes || []);
            setEdges(response.data.edges || []);
            alert('Fluxo salvo com sucesso!');
        } catch (error) {
            console.error('Erro ao salvar fluxo:', error);
            alert('Erro ao salvar o fluxo.');
        } finally {
            setIsSaving(false);
        }
    };

    const addNode = (type, pos = null) => {
        const spawnPos = pos || { x: 300 - canvasOffset.x, y: 200 - canvasOffset.y };
        const newNode = {
            id: 'node_' + Date.now(),
            type,
            position: spawnPos,
            data: {
                label: NODE_TYPES[type].label,
                content: '',
                buttons: []
            }
        };
        setNodes(curr => [...curr, newNode]);
        setSelectedNode(newNode.id);
        setContextMenu({ show: false, x: 0, y: 0, type: null, targetId: null });
    };

    const updateNodePosition = (id, delta) => {
        setNodes(curr => curr.map(n => n.id === id ? {
            ...n,
            position: { x: n.position.x + delta.x, y: n.position.y + delta.y }
        } : n));
    };

    const updateNodeData = (id, data) => {
        setNodes(curr => curr.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n));
    };

    const deleteNode = (id) => {
        setNodes(curr => curr.filter(n => n.id !== id));
        setEdges(curr => curr.filter(e => e.source !== id && e.target !== id));
        if (selectedNode === id) setSelectedNode(null);
    };

    // Connection Handlers

    const startConnection = (e, nodeId, handleId = null) => {
        e.stopPropagation();
        setIsConnecting(true);
        setConnectionSource(nodeId);
        setConnectionSourceHandle(handleId);
        const rect = canvasRef.current.getBoundingClientRect();
        setMousePos({
            x: e.clientX - rect.left - canvasOffset.x,
            y: e.clientY - rect.top - canvasOffset.y
        });
    };

    const finalizeConnection = (targetId) => {
        if (isConnecting && connectionSource && connectionSource !== targetId) {
            const exists = edges.some(e =>
                e.source === connectionSource &&
                e.target === targetId &&
                e.sourceHandle === connectionSourceHandle
            );
            if (!exists) {
                setEdges(prev => [...prev, {
                    id: `edge_${Date.now()}`,
                    source: connectionSource,
                    target: targetId,
                    sourceHandle: connectionSourceHandle
                }]);
            }
        }
        setIsConnecting(false);
        setConnectionSource(null);
        setConnectionSourceHandle(null);
    };

    const deleteEdge = (edgeId) => {
        setEdges(curr => curr.filter(e => e.id !== edgeId));
        setContextMenu({ show: false, x: 0, y: 0, type: null, targetId: null });
    };

    const handleCanvasContextMenu = (e) => {
        e.preventDefault();
        const rect = canvasRef.current.getBoundingClientRect();
        setContextMenu({
            show: true,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            type: 'canvas',
            targetId: null
        });
        setSelectedNode(null);
    };

    const handleCanvasMouseDown = (e) => {
        if (e.button === 0 && e.target === canvasRef.current) {
            setIsPanning(true);
            setContextMenu({ show: false, x: 0, y: 0 });
        }
    };

    const handleCanvasMouseMove = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (isPanning) {
            setCanvasOffset(prev => ({
                x: prev.x + e.movementX,
                y: prev.y + e.movementY
            }));
            return;
        }

        if (isConnecting) {
            setMousePos({
                x: x - canvasOffset.x,
                y: y - canvasOffset.y
            });
        }
    };

    const handleCanvasMouseUp = (e) => {
        setIsPanning(false);
        if (isConnecting && connectionSource) {
            // If released on empty canvas, show menu to create new node
            const rect = canvasRef.current.getBoundingClientRect();
            setContextMenu({
                show: true,
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                type: 'connection',
                targetId: connectionSource,
                sourceHandle: connectionSourceHandle
            });
        }
        setIsConnecting(false);
        setConnectionSource(null);
    };

    // Simulator Logic
    const startSimulator = () => {
        const startNode = nodes.find(n => n.type === 'start');
        if (!startNode) {
            alert('Adicione um bloco de Início para testar.');
            return;
        }
        setSimMessages([{ role: 'system', content: 'Simulador Iniciado' }]);
        setCurrentNodeId(startNode.id);
        setShowSimulator(true);
        processNextStep(startNode.id);
    };
    const processNextStep = (nodeId, buttonId = null) => {
        let nextEdge = edges.find(e => e.source === nodeId && e.sourceHandle === buttonId);

        // Fallback RESTRITO (como no backend)
        if (!nextEdge) {
            const edgesFromCurrent = edges.filter(e => e.source === nodeId);
            if (edgesFromCurrent.length === 1) {
                // Se houver apenas uma saída, seguimos ela (compatibilidade)
                nextEdge = edgesFromCurrent[0];
            } else if (!buttonId) {
                // Se for texto simples, procurar aresta sem handle
                nextEdge = edgesFromCurrent.find(e => !e.sourceHandle);
            }
        }

        if (!nextEdge) {
            setSimMessages(prev => [...prev, { role: 'bot', content: 'Fim do fluxo (sem mais conexões).' }]);
            return;
        }

        const nextNode = nodes.find(n => n.id === nextEdge.target);
        if (nextNode) {
            setTimeout(() => {
                if (nextNode.type === 'message') {
                    const buttons = nextNode.data.buttons || [];
                    setSimMessages(prev => [...prev, {
                        role: 'bot',
                        content: nextNode.data.content || '...',
                        buttons: buttons
                    }]);

                    // Sempre atualizar o nó atual no simulador
                    setCurrentNodeId(nextNode.id);

                    // Se não tiver botões, continua automaticamente após um delay
                    if (buttons.length === 0) {
                        processNextStep(nextNode.id);
                    }
                } else if (nextNode.type === 'menu') {
                    const rows = nextNode.data.rows || [];
                    setSimMessages(prev => [...prev, {
                        role: 'bot',
                        content: nextNode.data.content || '...',
                        menu: {
                            buttonText: nextNode.data.buttonText,
                            sectionTitle: nextNode.data.sectionTitle,
                            headerText: nextNode.data.headerText,
                            footerText: nextNode.data.footerText,
                            rows: rows
                        }
                    }]);
                    setCurrentNodeId(nextNode.id);
                } else {
                    setSimMessages(prev => [...prev, { role: 'system', content: `Executando: ${nextNode.data.label}` }]);
                    setCurrentNodeId(nextNode.id);
                    processNextStep(nextNode.id);
                }
            }, 800);
        }
    };

    const Node = ({ node }) => {
        const TypeConfig = NODE_TYPES[node.type] || NODE_TYPES.message;
        const isSelected = selectedNode === node.id;

        return (
            <motion.div
                drag
                dragMomentum={false}
                onDrag={(e, info) => {
                    updateNodePosition(node.id, info.delta);
                }}
                initial={false}
                style={{
                    position: 'absolute',
                    top: node.position.y,
                    left: node.position.x,
                    x: 0,
                    y: 0
                }}
                onMouseUp={(e) => {
                    if (isConnecting) {
                        e.stopPropagation();
                        finalizeConnection(node.id);
                    }
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(node.id);
                }}
                className={`group flex flex-col w-[240px] bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl transition-all cursor-move z-20 ${isSelected ? 'ring-2 ring-blue-500 border-blue-500 bg-slate-900' : 'hover:border-slate-700'
                    }`}
            >
                {/* Header do Nó */}
                <div className="flex items-center gap-3 p-4 border-b border-slate-900">
                    <div className={`p-2 rounded-xl text-white ${TypeConfig.color}`}>
                        <TypeConfig.icon size={16} />
                    </div>
                    <div className="flex flex-col flex-1 truncate">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none">
                            {TypeConfig.label}
                        </span>
                        <span className="text-xs font-bold text-white truncate mt-1">
                            {node.data.label || 'Nó sem título'}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                updateNodeData(node.id, { isCollapsed: !node.data.isCollapsed });
                            }}
                            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-all"
                            title={node.data.isCollapsed ? "Mostrar conteúdo" : "Esconder conteúdo"}
                        >
                            {node.data.isCollapsed ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-all"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>

                    {/* Output Point (General) - Apenas se não tiver botões ou for start/api */}
                    {(!node.data.buttons || node.data.buttons.length === 0) && (!node.data.rows || node.data.rows.length === 0) && (
                        <div
                            onMouseDown={(e) => startConnection(e, node.id, null)}
                            className="absolute -right-2 top-[35px] w-4 h-4 rounded-full bg-blue-500 border-4 border-slate-950 hover:scale-125 transition-all cursor-crosshair z-30"
                        />
                    )}
                </div>

                {/* Input Point (Left) */}
                <div className="absolute -left-1.5 top-[35px] w-3 h-3 bg-slate-700 border-2 border-slate-950 rounded-full" />

                {/* Botões do Nó (Para Branching) */}
                {!node.data.isCollapsed && (node.data.buttons || []).map((btn, bidx) => (
                    <div key={btn.id} className="relative px-4 py-2 border-b border-slate-900 last:border-0 group/btn">
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-blue-400 uppercase tracking-widest truncate">
                            {btn.title}
                        </div>
                        {/* Dot por botão */}
                        <div
                            onMouseDown={(e) => startConnection(e, node.id, btn.id)}
                            className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-blue-500 border-4 border-slate-950 hover:scale-125 transition-all cursor-crosshair z-30"
                        />
                    </div>
                ))}

                {/* Itens do Menu (Para Branching) */}
                {!node.data.isCollapsed && (node.data.rows || []).map((row, ridx) => (
                    <div key={row.id} className="relative px-4 py-2 border-b border-slate-900 last:border-0 group/row">
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-emerald-400 truncate">
                            {row.title}
                        </div>
                        {/* Dot por item */}
                        <div
                            onMouseDown={(e) => startConnection(e, node.id, row.id)}
                            className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-500 border-4 border-slate-950 hover:scale-125 transition-all cursor-crosshair z-30"
                        />
                    </div>
                ))}

                {/* Conteúdo Preview (Opcional) */}
                {!node.data.isCollapsed && node.data.content && (
                    <div className="p-4 pt-2">
                        <p className="text-[10px] text-slate-400 line-clamp-2 bg-slate-900/30 p-2 rounded-lg italic border border-slate-800/50">
                            "{node.data.content}"
                        </p>
                    </div>
                )}
            </motion.div>
        );
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 shadow-sm z-50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400">
                        <Bot size={24} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-none">
                            {currentFlow ? currentFlow.name : t('chatbot_builder')}
                        </h1>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-widest font-semibold text-blue-500">
                            Editor de Fluxos v2.0
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {currentFlow && (
                        <button
                            onClick={handleSaveFlow}
                            disabled={isSaving}
                            className={`flex items-center gap-2 px-6 py-2 text-sm font-bold rounded-xl transition-all shadow-sm ${isSaving ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg active:scale-95 border-b-4 border-blue-800'
                                }`}
                        >
                            <Save size={16} />
                            {isSaving ? 'Salvando...' : 'Salvar Fluxo'}
                        </button>
                    )}
                    <button
                        onClick={startSimulator}
                        className="flex items-center gap-2 px-6 py-2 text-sm font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl hover:opacity-90 transition-all active:scale-95 border-b-4 border-slate-700 dark:border-slate-300"
                    >
                        <Play size={16} />
                        Testar
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden relative">
                {!currentFlow ? (
                    <div className="flex-1 flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="max-w-md w-full p-10 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl text-center"
                        >
                            <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto mb-8 text-blue-600 dark:text-blue-400">
                                <Bot size={40} />
                            </div>
                            <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-4 uppercase italic">
                                Vamos automatizar?
                            </h2>
                            <p className="text-slate-600 dark:text-slate-400 mb-10 text-sm leading-relaxed">
                                Clique abaixo para iniciar o seu primeiro fluxo de chatbot.
                            </p>
                            <button
                                onClick={handleCreateFlow}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-sm rounded-2xl transition-all shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-1"
                            >
                                Criar Novo Fluxo
                            </button>
                        </motion.div>
                    </div>
                ) : (
                    <>
                        {/* Context Menu */}
                        <AnimatePresence>
                            {contextMenu.show && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    style={{
                                        position: 'absolute',
                                        top: contextMenu.y,
                                        left: contextMenu.x,
                                        zIndex: 100
                                    }}
                                    className="w-56 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl p-2"
                                >
                                    {contextMenu.type === 'edge' ? (
                                        <button
                                            onClick={() => deleteEdge(contextMenu.targetId)}
                                            className="w-full flex items-center gap-3 p-2.5 hover:bg-red-500/20 rounded-xl transition-all text-left group"
                                        >
                                            <div className="p-1.5 rounded-lg text-white bg-red-500 shadow-sm group-hover:scale-110 transition-transform">
                                                <Trash2 size={14} />
                                            </div>
                                            <span className="text-sm font-bold text-red-100 group-hover:text-red-50">Excluir Linha</span>
                                        </button>
                                    ) : (
                                        <>
                                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 p-2 mb-1">Adicionar Bloco</h3>
                                            {Object.entries(NODE_TYPES).map(([type, config]) => (
                                                <button
                                                    key={type}
                                                    onClick={() => {
                                                        const spawnPos = {
                                                            x: contextMenu.x - canvasOffset.x - 120,
                                                            y: contextMenu.y - canvasOffset.y - 23
                                                        };
                                                        const newNodeId = 'node_' + Date.now();
                                                        const newNode = {
                                                            id: newNodeId,
                                                            type,
                                                            position: spawnPos,
                                                            data: {
                                                                label: NODE_TYPES[type].label,
                                                                content: '',
                                                                buttons: [],
                                                                buttonText: type === 'menu' ? 'Ver Opções' : '',
                                                                sectionTitle: type === 'menu' ? 'Selecione uma opção' : '',
                                                                headerText: type === 'menu' ? 'MENU' : '',
                                                                footerText: type === 'menu' ? 'Clique para selecionar' : '',
                                                                rows: type === 'menu' ? [{ id: 'row_' + Date.now(), title: 'Opção 1', description: '' }] : []
                                                            }
                                                        };
                                                        setNodes(prev => [...prev, newNode]);
                                                        if (contextMenu.type === 'connection' && contextMenu.targetId) {
                                                            setEdges(prev => [...prev, {
                                                                id: `edge_${Date.now()}`,
                                                                source: contextMenu.targetId,
                                                                target: newNodeId,
                                                                sourceHandle: contextMenu.sourceHandle
                                                            }]);
                                                        }
                                                        setSelectedNode(newNodeId);
                                                        setContextMenu({ show: false, x: 0, y: 0, type: null, targetId: null });
                                                    }}
                                                    className="w-full flex items-center gap-3 p-2.5 hover:bg-white/5 rounded-xl transition-all text-left group"
                                                >
                                                    <div className={`p-1.5 rounded-lg text-white ${config.color} shadow-sm group-hover:scale-110 transition-transform`}>
                                                        <config.icon size={14} />
                                                    </div>
                                                    <span className="text-sm font-bold text-slate-300 group-hover:text-white">{config.label}</span>
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Canvas */}
                        <div
                            ref={canvasRef}
                            onMouseDown={handleCanvasMouseDown}
                            onMouseMove={handleCanvasMouseMove}
                            onMouseUp={handleCanvasMouseUp}
                            onContextMenu={handleCanvasContextMenu}
                            className="flex-1 overflow-hidden bg-slate-950 relative select-none"
                            onClick={() => {
                                setSelectedNode(null);
                                setContextMenu({ show: false, x: 0, y: 0, type: null, targetId: null });
                            }}
                        >
                            {/* Grid Background */}
                            <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_2px,transparent_2px)] dark:bg-[radial-gradient(#1e293b_2px,transparent_2px)] [background-size:32px_32px] opacity-40" />

                            <div
                                style={{
                                    transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
                                    transformOrigin: '0 0'
                                }}
                                className={`absolute inset-0 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
                                onPointerDown={(e) => {
                                    if (e.button === 0 && e.target === e.currentTarget) {
                                        setIsPanning(true);
                                        setContextMenu({ show: false, x: 0, y: 0, pendingConnection: null });
                                    }
                                }}
                            >
                                {/* SVG Layer for Edges */}
                                <svg className="absolute inset-0 pointer-events-none w-full h-full z-10 overflow-visible">
                                    {edges.map((edge) => {
                                        const sourceNode = nodes.find(n => n.id === edge.source);
                                        const targetNode = nodes.find(n => n.id === edge.target);
                                        if (!sourceNode || !targetNode) return null;

                                        // Side-to-side connections
                                        const x1 = sourceNode.position.x + 240;
                                        const x2 = targetNode.position.x - 5;
                                        const y2 = targetNode.position.y + 35; // Alinhado com o input dot

                                        // Calcular y1 baseado no sourceHandle
                                        let y1 = sourceNode.position.y + 35; // Alinhado com o dot de entrada/header

                                        if (edge.sourceHandle && !sourceNode.data.isCollapsed) {
                                            if (sourceNode.data.buttons) {
                                                const bidx = sourceNode.data.buttons.findIndex(b => b.id === edge.sourceHandle);
                                                if (bidx !== -1) {
                                                    // Header (~53px) + padding top do botão (8px) + metade do botão (18px)
                                                    y1 = sourceNode.position.y + 53 + (bidx * 45) + 26;
                                                }
                                            }
                                            if (sourceNode.data.rows) {
                                                const ridx = sourceNode.data.rows.findIndex(r => r.id === edge.sourceHandle);
                                                if (ridx !== -1) {
                                                    const btnOffset = (sourceNode.data.buttons?.length || 0) * 45;
                                                    y1 = sourceNode.position.y + 53 + btnOffset + (ridx * 45) + 26;
                                                }
                                            }
                                        }

                                        return (
                                            <g key={edge.id}>
                                                <path
                                                    d={`M ${x1} ${y1} C ${x1 + 100} ${y1}, ${x2 - 100} ${y2}, ${x2} ${y2}`}
                                                    fill="none"
                                                    stroke="transparent"
                                                    strokeWidth="20"
                                                    className="pointer-events-auto cursor-pointer"
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const rect = canvasRef.current.getBoundingClientRect();
                                                        setContextMenu({
                                                            show: true,
                                                            x: e.clientX - rect.left,
                                                            y: e.clientY - rect.top,
                                                            type: 'edge',
                                                            targetId: edge.id
                                                        });
                                                    }}
                                                />
                                                <path
                                                    d={`M ${x1} ${y1} C ${x1 + 100} ${y1}, ${x2 - 100} ${y2}, ${x2} ${y2}`}
                                                    fill="none"
                                                    stroke={edge.sourceHandle?.startsWith('row') ? '#10b981' : '#3b82f6'}
                                                    strokeWidth="3"
                                                    className="opacity-60 drop-shadow-sm pointer-events-none transition-all"
                                                />
                                                <circle cx={x2} cy={y2} r="4" fill={edge.sourceHandle?.startsWith('row') ? '#10b981' : '#3b82f6'} className="pointer-events-none" />
                                            </g>
                                        );
                                    })}

                                    {isConnecting && connectionSource && (() => {
                                        const sNode = nodes.find(n => n.id === connectionSource);
                                        let sy = sNode.position.y + 35;
                                        if (connectionSourceHandle) {
                                            if (sNode.data.buttons) {
                                                const bidx = sNode.data.buttons.findIndex(b => b.id === connectionSourceHandle);
                                                if (bidx !== -1) sy = sNode.position.y + 62 + (bidx * 53) + 26;
                                            }
                                            if (sNode.data.rows) {
                                                const ridx = sNode.data.rows.findIndex(r => r.id === connectionSourceHandle);
                                                if (ridx !== -1) {
                                                    const btnO = (sNode.data.buttons?.length || 0) * 53;
                                                    sy = sNode.position.y + 62 + btnO + (ridx * 53) + 26;
                                                }
                                            }
                                        }
                                        return (
                                            <path
                                                d={`M ${sNode.position.x + 240} ${sy} 
                                                    C ${sNode.position.x + 340} ${sy},
                                                      ${mousePos.x - 50} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`}
                                                fill="none"
                                                stroke={connectionSourceHandle?.startsWith('row') ? '#10b981' : '#3b82f6'}
                                                strokeWidth="2"
                                                strokeDasharray="6,6"
                                            />
                                        );
                                    })()}
                                </svg>

                                {nodes.map(node => (
                                    <Node key={node.id} node={node} />
                                ))}
                            </div>

                        </div>

                        {/* Property Sidepanel */}
                        <AnimatePresence>
                            {selectedNode && (
                                <motion.div
                                    initial={{ x: 400 }}
                                    animate={{ x: 0 }}
                                    exit={{ x: 400 }}
                                    className="w-96 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 z-50 shadow-2xl flex flex-col"
                                >
                                    <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                                        <div>
                                            <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-400 mb-1">Configuração</h3>
                                            <p className="text-sm font-bold text-slate-800 dark:text-white">Editor de Propriedades</p>
                                        </div>
                                        <button onClick={() => setSelectedNode(null)} className="p-3 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-2xl transition-colors text-slate-500">
                                            <X size={20} />
                                        </button>
                                    </div>

                                    <div className="p-8 space-y-8 flex-1 overflow-y-auto">
                                        <div>
                                            <div className="flex items-center justify-between mb-3">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome do Bloco (Apelido)</label>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-md">Identificação</span>
                                                </div>
                                            </div>
                                            <input
                                                type="text"
                                                value={nodes.find(n => n.id === selectedNode)?.data.label || ''}
                                                onChange={(e) => updateNodeData(selectedNode, { label: e.target.value })}
                                                placeholder="Ex: Menu Principal, Boas-vindas"
                                                className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-white font-bold placeholder:font-normal shadow-inner"
                                            />
                                            <p className="text-[9px] text-slate-400 mt-2 italic px-1">Este nome serve para você se organizar no canvas.</p>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Conteúdo da Mensagem</label>
                                            <textarea
                                                rows={6}
                                                value={nodes.find(n => n.id === selectedNode)?.data.content || ''}
                                                onChange={(e) => updateNodeData(selectedNode, { content: e.target.value })}
                                                placeholder="Olá! Como posso te ajudar hoje?"
                                                className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-white resize-none font-bold placeholder:font-normal"
                                            />
                                        </div>

                                        {nodes.find(n => n.id === selectedNode)?.type === 'message' && (
                                            <div>
                                                <div className="flex items-center justify-between mb-4">
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Botões Interativos (Meta)</label>
                                                    <span className="text-[10px] font-bold text-slate-400">{(nodes.find(n => n.id === selectedNode)?.data.buttons || []).length}/3</span>
                                                </div>

                                                <div className="space-y-3">
                                                    {(nodes.find(n => n.id === selectedNode)?.data.buttons || []).map((btn, idx) => (
                                                        <div key={idx} className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                value={btn.title}
                                                                placeholder="Título do botão"
                                                                maxLength={20}
                                                                onChange={(e) => {
                                                                    const currentButtons = [...(nodes.find(n => n.id === selectedNode)?.data.buttons || [])];
                                                                    currentButtons[idx].title = e.target.value;
                                                                    updateNodeData(selectedNode, { buttons: currentButtons });
                                                                }}
                                                                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500"
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const currentButtons = (nodes.find(n => n.id === selectedNode)?.data.buttons || []).filter((_, i) => i !== idx);
                                                                    updateNodeData(selectedNode, { buttons: currentButtons });
                                                                }}
                                                                className="p-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ))}

                                                    {(nodes.find(n => n.id === selectedNode)?.data.buttons || []).length < 3 && (
                                                        <button
                                                            onClick={() => {
                                                                const currentButtons = [...(nodes.find(n => n.id === selectedNode)?.data.buttons || [])];
                                                                currentButtons.push({ id: 'btn_' + Date.now(), title: 'Novo Botão' });
                                                                updateNodeData(selectedNode, { buttons: currentButtons });
                                                            }}
                                                            className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-400 hover:text-blue-500 hover:border-blue-500 transition-all font-bold text-xs flex items-center justify-center gap-2"
                                                        >
                                                            <Plus size={16} />
                                                            Adicionar Botão
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {nodes.find(n => n.id === selectedNode)?.type === 'menu' && (
                                            <div className="space-y-6">
                                                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/30 rounded-2xl">
                                                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest mb-1">Dica WhatsApp</p>
                                                    <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 leading-relaxed">
                                                        Este bloco cria uma **Lista Interativa**. Ideal para menus com mais de 3 opções (limite de botões).
                                                    </p>
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Cabeçalho (Header)</label>
                                                    <input
                                                        type="text"
                                                        value={nodes.find(n => n.id === selectedNode)?.data.headerText || ''}
                                                        onChange={(e) => updateNodeData(selectedNode, { headerText: e.target.value })}
                                                        placeholder="Ex: MENU"
                                                        maxLength={60}
                                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Conteúdo da Mensagem (Body)</label>
                                                    <textarea
                                                        rows={4}
                                                        value={nodes.find(n => n.id === selectedNode)?.data.content || ''}
                                                        onChange={(e) => updateNodeData(selectedNode, { content: e.target.value })}
                                                        placeholder="Escolha a opção desejada:"
                                                        className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-white resize-none font-bold placeholder:font-normal"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Rodapé (Footer)</label>
                                                    <input
                                                        type="text"
                                                        value={nodes.find(n => n.id === selectedNode)?.data.footerText || ''}
                                                        onChange={(e) => updateNodeData(selectedNode, { footerText: e.target.value })}
                                                        placeholder="Ex: Clique na lista abaixo..."
                                                        maxLength={60}
                                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500"
                                                    />
                                                </div>

                                                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Texto do Botão da Lista</label>
                                                    <input
                                                        type="text"
                                                        value={nodes.find(n => n.id === selectedNode)?.data.buttonText || ''}
                                                        onChange={(e) => updateNodeData(selectedNode, { buttonText: e.target.value })}
                                                        placeholder="Ex: Abrir Menu"
                                                        maxLength={20}
                                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Título da Seção</label>
                                                    <input
                                                        type="text"
                                                        value={nodes.find(n => n.id === selectedNode)?.data.sectionTitle || ''}
                                                        onChange={(e) => updateNodeData(selectedNode, { sectionTitle: e.target.value })}
                                                        placeholder="Ex: Selecione uma opção"
                                                        maxLength={24}
                                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-blue-500"
                                                    />
                                                </div>

                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Opções do Menu</label>
                                                        <span className="text-[10px] font-bold text-slate-400">{(nodes.find(n => n.id === selectedNode)?.data.rows || []).length}/10</span>
                                                    </div>

                                                    <div className="space-y-4">
                                                        {(nodes.find(n => n.id === selectedNode)?.data.rows || []).map((row, idx) => (
                                                            <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-3">
                                                                <div className="flex justify-between items-center gap-2">
                                                                    <input
                                                                        type="text"
                                                                        value={row.title}
                                                                        placeholder="Título da opção"
                                                                        maxLength={24}
                                                                        onChange={(e) => {
                                                                            const currentRows = [...(nodes.find(n => n.id === selectedNode)?.data.rows || [])];
                                                                            currentRows[idx].title = e.target.value;
                                                                            updateNodeData(selectedNode, { rows: currentRows });
                                                                        }}
                                                                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-blue-500"
                                                                    />
                                                                    <button
                                                                        onClick={() => {
                                                                            const currentRows = (nodes.find(n => n.id === selectedNode)?.data.rows || []).filter((_, i) => i !== idx);
                                                                            updateNodeData(selectedNode, { rows: currentRows });
                                                                        }}
                                                                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    value={row.description || ''}
                                                                    placeholder="Descrição (opcional)"
                                                                    maxLength={72}
                                                                    onChange={(e) => {
                                                                        const currentRows = [...(nodes.find(n => n.id === selectedNode)?.data.rows || [])];
                                                                        currentRows[idx].description = e.target.value;
                                                                        updateNodeData(selectedNode, { rows: currentRows });
                                                                    }}
                                                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-[10px] font-medium outline-none focus:border-blue-500"
                                                                />
                                                            </div>
                                                        ))}

                                                        {(nodes.find(n => n.id === selectedNode)?.data.rows || []).length < 10 && (
                                                            <button
                                                                onClick={() => {
                                                                    const currentRows = [...(nodes.find(n => n.id === selectedNode)?.data.rows || [])];
                                                                    currentRows.push({
                                                                        id: 'row_' + Date.now(),
                                                                        title: 'Nova Opção',
                                                                        description: ''
                                                                    });
                                                                    updateNodeData(selectedNode, { rows: currentRows });
                                                                }}
                                                                className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-400 hover:text-pink-500 hover:border-pink-500 transition-all font-bold text-xs flex items-center justify-center gap-2"
                                                            >
                                                                <Plus size={16} />
                                                                Adicionar Opção
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {nodes.find(n => n.id === selectedNode)?.type === 'sgp' && (() => {
                                            const sgpNode = nodes.find(n => n.id === selectedNode);
                                            const sgpAction = sgpNode?.data.sgpAction || 'consultar_cliente';
                                            const SGP_ENDPOINTS = [
                                                { value: 'consultar_cliente', label: 'Consultar Cliente (CPF/CNPJ)', input: 'cpf', desc: 'Retorna dados e contratos do cliente. Variáveis: {{nome}}, {{contratos}}' },
                                                { value: 'verifica_acesso', label: 'Verificar Acesso (Contrato)', input: 'contrato', desc: 'Verifica status da conexão do contrato. Variável: {{status_acesso}}' },
                                                { value: 'listar_contratos', label: 'Listar Contratos (Cliente ID)', input: 'cliente_id', desc: 'Lista todos os contratos do cliente. Variável: {{contratos}}' },
                                                { value: 'segunda_via_fatura', label: 'Segunda Via de Fatura (CPF)', input: 'cpf', desc: 'Retorna link do boleto. Variável: {{link_fatura}}' },
                                                { value: 'listar_titulos', label: 'Listar Títulos/Faturas (CPF)', input: 'cpf', desc: 'Lista faturas em aberto. Variável: {{titulos}}' },
                                                { value: 'gerar_pix', label: 'Gerar PIX (ID Fatura)', input: 'fatura_id', desc: 'Gera chave PIX para pagamento. Variável: {{pix_code}}' },
                                                { value: 'liberar_por_confianca', label: 'Liberar por Confiança (Contrato)', input: 'contrato', desc: 'Faz liberação por promessa de pagamento. Variável: {{sucesso}}' },
                                                { value: 'criar_chamado', label: 'Criar Chamado Técnico (Contrato)', input: 'contrato', desc: 'Abre chamado no SGP. Variável: {{protocolo}}' },
                                                { value: 'listar_manutencoes', label: 'Listar Manutenções (CPF)', input: 'cpf', desc: 'Lista manutenções na área do cliente. Variável: {{manutencoes}}' },
                                            ];
                                            const selectedEndpoint = SGP_ENDPOINTS.find(e => e.value === sgpAction) || SGP_ENDPOINTS[0];
                                            return (
                                                <div className="space-y-5">
                                                    <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/30 rounded-2xl">
                                                        <p className="text-[10px] text-purple-700 dark:text-purple-400 font-bold uppercase tracking-widest mb-1">Bloco SGP</p>
                                                        <p className="text-[10px] text-purple-700/70 dark:text-purple-400/70 leading-relaxed">
                                                            Este bloco consulta a API do seu SGP e salva o resultado no contexto do fluxo, disponível nos próximos blocos.
                                                        </p>
                                                    </div>

                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Endpoint / Ação</label>
                                                        <select
                                                            value={sgpAction}
                                                            onChange={(e) => updateNodeData(selectedNode, { sgpAction: e.target.value })}
                                                            className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-xs font-bold outline-none focus:border-purple-500 transition-all text-slate-800 dark:text-white"
                                                        >
                                                            {SGP_ENDPOINTS.map(ep => (
                                                                <option key={ep.value} value={ep.value}>{ep.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                                            Variável de Entrada: <span className="text-purple-500 font-black">&#123;&#123;{selectedEndpoint.input}&#125;&#125;</span>
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={sgpNode?.data.inputVar || selectedEndpoint.input}
                                                            onChange={(e) => updateNodeData(selectedNode, { inputVar: e.target.value })}
                                                            placeholder={`Nome da variável (ex: ${selectedEndpoint.input})`}
                                                            className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-xs font-bold outline-none focus:border-purple-500 transition-all"
                                                        />
                                                        <p className="text-[9px] text-slate-400 mt-1 px-1 italic">Nome da variável de contexto que será usada como entrada.</p>
                                                    </div>

                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Mensagem de Erro (opcional)</label>
                                                        <input
                                                            type="text"
                                                            value={sgpNode?.data.errorMessage || ''}
                                                            onChange={(e) => updateNodeData(selectedNode, { errorMessage: e.target.value })}
                                                            placeholder="Ex: Cliente não encontrado no sistema."
                                                            className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-xs font-bold outline-none focus:border-purple-500 transition-all"
                                                        />
                                                    </div>

                                                    {sgpAction === 'listar_titulos' && (
                                                        <>
                                                            <div>
                                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 text-purple-500">Mensagem de Sucesso/Encerramento</label>
                                                                <textarea
                                                                    value={sgpNode?.data.successMessage || ''}
                                                                    onChange={(e) => updateNodeData(selectedNode, { successMessage: e.target.value })}
                                                                    placeholder="Ex: Obrigado! Suas faturas foram enviadas acima. Deseja mais alguma coisa?"
                                                                    rows={3}
                                                                    className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-xs font-bold outline-none focus:border-purple-500 transition-all resize-none"
                                                                />
                                                                <p className="text-[9px] text-slate-400 mt-1 px-1 italic">Esta mensagem será enviada após a listagem das faturas.</p>
                                                            </div>

                                                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 border-2 border-slate-200 dark:border-slate-800 rounded-2xl">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Encerrar Atendimento</span>
                                                                    <span className="text-[9px] text-slate-500 font-medium">Fecha a conversa automaticamente após o envio</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => updateNodeData(selectedNode, { autoClose: !sgpNode?.data.autoClose })}
                                                                    className={`w-12 h-6 rounded-full transition-all relative ${sgpNode?.data.autoClose ? 'bg-purple-500 shadow-lg shadow-purple-500/30' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                                >
                                                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${sgpNode?.data.autoClose ? 'left-7' : 'left-1'}`} />
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}

                                                    <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                                                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Resultado disponível:</p>
                                                        <p className="text-[9px] text-purple-500 font-bold">{selectedEndpoint.desc}</p>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div className="p-5 bg-blue-50 dark:bg-blue-900/20 rounded-3xl border border-blue-100 dark:border-blue-800/30">
                                            <div className="flex items-center gap-3 mb-3 text-blue-600 dark:text-blue-400">
                                                <Zap size={18} />
                                                <span className="text-xs font-black uppercase tracking-widest">Motor de Fluxo</span>
                                            </div>
                                            <p className="text-xs text-blue-700/70 dark:text-blue-400/70 leading-relaxed font-medium">
                                                Este bloco será executado automaticamente quando o usuário chegar nesta etapa do fluxo.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-8 border-t border-slate-100 dark:border-slate-700">
                                        <button
                                            onClick={() => deleteNode(selectedNode)}
                                            className="w-full flex items-center justify-center gap-3 py-5 bg-red-50 dark:bg-red-900/10 text-red-500 hover:bg-red-500 hover:text-white rounded-2xl transition-all font-black text-xs uppercase tracking-widest border border-red-100 dark:border-red-900/30"
                                        >
                                            <Trash2 size={18} />
                                            Remover este Bloco
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                )}
            </div>

            {/* Simulator Modal */}
            <AnimatePresence>
                {showSimulator && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-white dark:bg-slate-800 w-full max-w-lg h-[600px] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
                        >
                            {/* Simulator Header */}
                            <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600">
                                        <Bot size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-black text-xs uppercase tracking-widest text-slate-800 dark:text-white">Simulador</h3>
                                        <p className="text-[10px] text-emerald-500 font-bold">Fluxo Ativo</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowSimulator(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors">
                                    <X size={20} className="text-slate-500" />
                                </button>
                            </div>

                            {/* Chat Messages */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 dark:bg-slate-900/30">
                                {simMessages.map((msg, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: msg.role === 'bot' ? -10 : 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className={`flex ${msg.role === 'bot' ? 'justify-start' : 'justify-center'}`}
                                    >
                                        {msg.role === 'system' ? (
                                            <div className="px-4 py-1.5 bg-slate-200 dark:bg-slate-700 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                                {msg.content}
                                            </div>
                                        ) : (
                                            <div className="max-w-[80%] space-y-3">
                                                <div className="p-4 bg-white dark:bg-slate-700 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 font-medium">
                                                    {msg.content}
                                                </div>
                                                {msg.menu && (
                                                    <div className="flex flex-col gap-2">
                                                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden shadow-sm">
                                                            {msg.menu.headerText && (
                                                                <div className="p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                                    {msg.menu.headerText}
                                                                </div>
                                                            )}
                                                            <div className="p-4 text-sm text-slate-700 dark:text-slate-200 font-medium leading-relaxed">
                                                                {msg.content}
                                                            </div>
                                                            {msg.menu.footerText && (
                                                                <div className="px-4 pb-3 text-[10px] text-slate-400 font-medium italic">
                                                                    {msg.menu.footerText}
                                                                </div>
                                                            )}
                                                            <div className="p-2.5 bg-emerald-50/50 dark:bg-emerald-900/10 border-t border-slate-100 dark:border-slate-800">
                                                                <div className="flex items-center justify-center gap-2 py-1.5 bg-white dark:bg-slate-800 border border-emerald-100 dark:border-emerald-900/50 rounded-lg shadow-sm">
                                                                    <List size={14} className="text-emerald-500" />
                                                                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                                                        {msg.menu.buttonText || 'Ver Opções'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Preview of rows in simulator */}
                                                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden shadow-md mt-1 animate-in slide-in-from-top-2">
                                                            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                                                                {msg.menu.sectionTitle || 'Opções'}
                                                            </div>
                                                            {msg.menu.rows.map(row => (
                                                                <button
                                                                    key={row.id}
                                                                    onClick={() => {
                                                                        setSimMessages(prev => [...prev, { role: 'user', content: row.title }]);
                                                                        processNextStep(currentNodeId, row.id);
                                                                    }}
                                                                    className="w-full p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors"
                                                                >
                                                                    <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{row.title}</p>
                                                                    {row.description && <p className="text-[10px] text-slate-400 mt-0.5">{row.description}</p>}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {msg.buttons && msg.buttons.length > 0 && (
                                                    <div className="flex flex-col gap-2">
                                                        {msg.buttons.map(btn => (
                                                            <button
                                                                key={btn.id}
                                                                onClick={() => {
                                                                    setSimMessages(prev => [...prev, { role: 'user', content: btn.title }]);
                                                                    processNextStep(currentNodeId, btn.id);
                                                                }}
                                                                className="w-full py-3 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-black text-blue-600 uppercase tracking-widest transition-all shadow-sm"
                                                            >
                                                                {btn.title}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </div>

                            {/* Simulator Footer */}
                            <div className="p-6 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex gap-2">
                                    <button
                                        onClick={startSimulator}
                                        className="flex-1 py-4 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all"
                                    >
                                        Reiniciar
                                    </button>
                                    <button className="flex-1 py-4 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl opacity-50 cursor-not-allowed">
                                        Responder
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
};

export default ChatbotBuilder;
