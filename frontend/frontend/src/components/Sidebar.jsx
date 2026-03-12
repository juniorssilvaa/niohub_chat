import React, { useState, useEffect, createContext, useContext } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  MessageCircle,
  Users,
  Shield,
  Settings,
  Crown,
  LayoutGrid,
  Clock,
  User,
  MessagesSquare, // Ícone para Conversas
  UserCog, // Ícone para Equipes
  Notebook, // Ícone para Contatos
  Headphones, // Ícone para Atendimento
  RefreshCw, // Ícone para Recuperador
  Smile, // Ícone para CSAT
  PlugZap, // Ícone para Integrações
  ScrollText, // Ícone para Auditoria
  Bot, // Ícone para Construtor de Chatbot
  Wifi, // Ícone para Planos
  ChevronsLeft,
  ChevronsRight,
  Zap, // Ícone para Respostas Rápidas
} from 'lucide-react';
import logo from '../assets/logo.png';
import { useLanguage } from '../contexts/LanguageContext';

// Context para compartilhar estado do sidebar
const SidebarContext = createContext({
  isCollapsed: false,
  setIsCollapsed: () => { }
});

export const useSidebarContext = () => useContext(SidebarContext);

const Sidebar = ({ userRole = 'agent', userPermissions = [], mobileOpen, onClose, provedorId, onCollapseChange }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const { t } = useLanguage();

  // Salvar estado no localStorage e notificar componente pai
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', isCollapsed.toString());
    if (onCollapseChange) {
      onCollapseChange(isCollapsed);
    }
  }, [isCollapsed, onCollapseChange]);

  // Função para verificar se um item do menu está ativo
  const isActive = (path) => {
    return currentPath.includes(path);
  };

  // Menu base com todos os itens
  const allMenuItems = [
    { id: 'dashboard', icon: LayoutGrid, label: t('dashboard'), path: `/app/accounts/${provedorId}/dashboard` },
    { id: 'conversations', icon: Headphones, label: t('conversations'), path: `/app/accounts/${provedorId}/conversations` },
    { id: 'conversas', icon: MessagesSquare, label: t('conversas'), path: `/app/accounts/${provedorId}/conversas` },
    { id: 'contacts', icon: Notebook, label: t('contacts'), path: `/app/accounts/${provedorId}/contacts`, permission: 'manage_contacts' },
    { id: 'users', icon: Users, label: t('users'), path: `/app/accounts/${provedorId}/users` },
    { id: 'teams', icon: UserCog, label: t('equipes'), path: `/app/accounts/${provedorId}/equipes` },
    { id: 'audit', icon: ScrollText, label: t('audit'), path: `/app/accounts/${provedorId}/audit` },
    { id: 'chatbot-builder', icon: Bot, label: t('chatbot_builder'), path: `/app/accounts/${provedorId}/chatbot-manager` },
    { id: 'planos', icon: Wifi, label: t('planos'), path: `/app/accounts/${provedorId}/planos` },
    { id: 'csat', icon: Smile, label: t('csat'), path: `/app/accounts/${provedorId}/csat` },
    { id: 'respostas-rapidas', icon: Zap, label: 'Respostas Rápidas', path: `/app/accounts/${provedorId}/respostas-rapidas` },
  ];

  // Filtrar itens baseado no papel do usuário
  let menuItems = [];
  if (userRole === 'superadmin') {
    menuItems = [
      { id: 'superadmin-dashboard', icon: Crown, label: t('dashboard_superadmin'), path: '/superadmin' },
      ...allMenuItems
    ];
  } else if (userRole === 'admin') {
    // Admins veem todos os itens do provedor
    menuItems = allMenuItems;
  } else if (userRole === 'agent') {
    // Atendentes veem apenas itens permitidos
    menuItems = allMenuItems.filter(item => {
      // Itens sem a chave 'permission' são visíveis se estiverem na lista de permissões do agente
      if (!item.permission) {
        return ['conversations'].includes(item.id);
      }
      // Itens com a chave 'permission' são visíveis se o usuário tiver a permissão
      return userPermissions.includes(item.permission);
    });
  } else {
    // Fallback: mostra apenas o dashboard
    menuItems = allMenuItems.filter(item => item.id === 'dashboard');
  }

  // Itens fixos - filtrar baseado no papel
  const allFixedItems = [
    { id: 'horario', icon: Clock, label: t('horario'), path: `/app/accounts/${provedorId}/horario-provedor` },
    { id: 'integracoes', icon: PlugZap, label: t('integracoes'), path: `/app/accounts/${provedorId}/integracoes` },
    { id: 'dados-provedor', icon: Settings, label: t('dados_provedor'), path: `/app/accounts/${provedorId}/dados-provedor` },
    { id: 'recovery', icon: RefreshCw, label: t('recovery'), path: `/app/accounts/${provedorId}/recovery` },
    { id: 'perfil', icon: User, label: t('perfil'), path: `/app/accounts/${provedorId}/perfil` },
  ];

  let fixedItems = [];
  if (userRole === 'agent') {
    // Atendentes veem apenas perfil
    fixedItems = [
      { id: 'perfil', icon: User, label: t('perfil'), path: `/app/accounts/${provedorId}/perfil` },
    ];
  } else {
    // Admins e superadmins veem todos os itens fixos
    fixedItems = allFixedItems;
  }

  // Detectar se está em mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Componente de item do menu
  const MenuItem = ({ item, onClick }) => {
    const Icon = item.icon;
    const isActive = currentPath === item.path;
    return (
      <li>
        <button
          onClick={onClick}
          className={`niochat-sidebar-item ${isActive ? 'niochat-sidebar-item-active' : ''}`}
        >
          <Icon className="w-5 h-5" />
          <span className={`flex-1 text-left ${isCollapsed ? 'hidden' : ''}`}>{item.label}</span>
          {item.session && (
            <span className={`px-2 py-1 text-xs font-medium bg-green-500 text-white rounded-full ${isCollapsed ? 'hidden' : ''}`}>
              session
            </span>
          )}
        </button>
      </li>
    );
  };

  // Overlay para mobile
  if (isMobile) {
    return (
      <>
        <div
          className={`fixed inset-0 z-40 bg-black bg-opacity-40 transition-opacity ${mobileOpen ? 'block' : 'hidden'}`}
          onClick={onClose}
        />
        <aside
          className={`fixed top-0 left-0 z-50 h-full w-64 niochat-sidebar shadow-lg transform transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="p-4 flex items-center gap-3">
            <img src={logo} alt="Logo" className="w-8 h-8 rounded-lg" />
            <div className="text-xl font-bold tracking-tight">Nio Chat</div>
            <button className="ml-auto p-2" onClick={onClose} aria-label="Fechar menu">
              <span style={{ fontSize: 24, fontWeight: 'bold' }}>&times;</span>
            </button>
          </div>
          <nav className="niochat-sidebar-nav">
            <ul className="niochat-sidebar-menu">
              {menuItems.map((item) => (
                <MenuItem
                  key={item.id}
                  item={item}
                  onClick={() => { navigate(item.path); onClose && onClose(); }}
                />
              ))}
            </ul>
            <ul className="niochat-sidebar-menu-fixed">
              {fixedItems.map((item) => (
                <MenuItem
                  key={item.id}
                  item={item}
                  onClick={() => { navigate(item.path); onClose && onClose(); }}
                />
              ))}
            </ul>
          </nav>
        </aside>
      </>
    );
  }

  // Desktop: sidebar fixo
  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      <aside className={`h-full ${isCollapsed ? 'w-16' : 'w-64'} z-30 flex-shrink-0 flex flex-col`}>
        <div className={`bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full flex flex-col ${mobileOpen ? 'mobile-open' : ''}`}>
          {/* TOPO FIXO - Logo e Botão */}
          <div className={`p-4 border-b border-border flex items-center flex-shrink-0 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
            <img src={logo} alt="NioChat" className={`h-8 transition-opacity duration-300 ${isCollapsed ? 'hidden' : 'block'}`} />
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
              aria-label={isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
            >
              {isCollapsed ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
            </button>
          </div>

          {/* CENTRO FLEXÍVEL - Menu Items com scroll */}
          <div className="flex-1 flex flex-col min-h-0">
            <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2">
              <div className={isCollapsed ? 'space-y-3' : 'space-y-1'}>
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} gap-3 ${isCollapsed ? 'px-2' : 'px-4'} ${isCollapsed ? 'py-3' : 'py-2'} rounded-lg transition-colors ${isActive(item.path)
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        }`}
                      title={isCollapsed ? item.label : ''}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      <span className={`transition-opacity duration-300 ${isCollapsed ? 'hidden' : 'inline'}`}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>

          {/* RODAPÉ FIXO - Fixed Items */}
          <div className="p-2 border-t border-border flex-shrink-0">
            <div className={isCollapsed ? 'space-y-3' : 'space-y-1'}>
              {fixedItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} gap-3 ${isCollapsed ? 'px-2' : 'px-4'} ${isCollapsed ? 'py-3' : 'py-2'} rounded-lg transition-colors ${isActive(item.path)
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      }`}
                    title={isCollapsed ? item.label : ''}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className={`transition-opacity duration-300 ${isCollapsed ? 'hidden' : 'inline'}`}>{item.label}</span>
                    {item.session && (
                      <span className={`px-2 py-1 text-xs font-medium bg-green-500 text-white rounded-full ml-auto transition-opacity duration-300 ${isCollapsed ? 'hidden' : 'inline'}`}>
                        {t('session')}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </SidebarContext.Provider>
  );
};

export default Sidebar;

