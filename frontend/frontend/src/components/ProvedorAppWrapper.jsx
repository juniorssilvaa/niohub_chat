import React, { useEffect, useRef, useState } from 'react';
import { useParams, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import DashboardPrincipal from './DashboardPrincipal';
import ConversasDashboard from './ConversasDashboard';
import Contacts from './Contacts2';
import ConversationsPage from './ConversationsPage';
import Settings from './Settings';
import UserManagement from './UserManagement';
import TeamsPage from './TeamsPage';
import ConversationAudit from './ConversationAudit';
import ConversationRecovery from './ConversationRecovery';
import CompanyManagement from './CompanyManagement';
import CSATDashboard from './CSATDashboard';
import Integrations from './Integrations';
import ProfilePage from './ProfilePage';
import AppearancePage from './AppearancePage';
import ProviderDataForm from './ProviderDataForm';
import ProviderScheduleForm from './ProviderScheduleForm';
import Changelog from './Changelog';
import ChatbotBuilder from './ChatbotBuilder';
import ChatbotManager from './ChatbotManager';
import PlanosPage from './PlanosPage';
import RespostasRapidas from './RespostasRapidas';
import RemindersModal from './RemindersModal';

export default function ProvedorAppWrapper({ user, userRole, handleLogout, setWhatsappDisconnected }) {
  const { provedorId } = useParams();
  const location = useLocation();
  const lastStatusRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [showChangelog, setShowChangelog] = useState(false);
  const [showRemindersModal, setShowRemindersModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Monitorar status do WhatsApp
  useEffect(() => {
    if (!provedorId) return;
    let interval;
    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const res = await fetch(`/api/canais/`, {
          headers: { 'Authorization': `Token ${token}` }
        });
        const data = await res.json();
        const whatsappSession = (data.results || data).find(c => c.tipo === 'whatsapp_session' && c.dados_extras?.instance_id);
        if (whatsappSession) {
          const statusRes = await fetch(`/api/whatsapp/session/status/${whatsappSession.id}/`, {
            method: 'POST',
            headers: { 'Authorization': `Token ${token}` }
          });
          const statusData = await statusRes.json();
          if (statusData.status === 'connected' && statusData.loggedIn) {
            lastStatusRef.current = 'connected';
          }
          if (
            (lastStatusRef.current === 'connected' && (statusData.status === 'disconnected' || !statusData.loggedIn)) ||
            (lastStatusRef.current === null && (statusData.status === 'disconnected' || !statusData.loggedIn))
          ) {
            setWhatsappDisconnected(true);
            lastStatusRef.current = 'disconnected';
          }
        }
      } catch (e) {
        // Silenciar erros
      }
    };
    fetchStatus();
    interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [provedorId, setWhatsappDisconnected]);

  // Proteção de rotas baseada no papel do usuário
  const isAdminRoute = (path) => {
    const adminRoutes = ['dashboard', 'users', 'equipes', 'audit', 'companies', 'integracoes', 'dados-provedor', 'horario-provedor'];
    return adminRoutes.some(route => path.includes(route));
  };

  if (userRole === 'agent' && isAdminRoute(location.pathname)) {
    return <Navigate to={`/app/accounts/${provedorId}/conversations`} replace />;
  }

  const handleChangelog = () => {
    setShowChangelog(true);
  };

  const handleNotifications = () => {
    // Placeholder
  };

  return (
    <div className="fixed inset-0 bg-background text-foreground flex overflow-hidden w-full">
      <Sidebar
        userRole={userRole}
        userPermissions={user?.permissions || []}
        provedorId={provedorId}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCollapseChange={setSidebarCollapsed}
        onRemindersClick={() => setShowRemindersModal(true)}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 w-full h-full">
        <Topbar
          onLogout={handleLogout}
          onChangelog={handleChangelog}
          onNotifications={handleNotifications}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <div className="flex-1 overflow-y-auto w-full overflow-x-hidden min-h-0 relative">
          <div className="w-full h-full">
            <Routes>
              <Route path="dashboard" element={<DashboardPrincipal provedorId={provedorId} />} />
              <Route path="conversas" element={<ConversasDashboard provedorId={provedorId} />} />
              <Route path="conversas-dashboard" element={<ConversasDashboard provedorId={provedorId} />} />
              <Route path="contacts" element={<Contacts provedorId={provedorId} />} />
              <Route path="conversations" element={
                <ConversationsPage
                  selectedConversation={selectedConversation}
                  setSelectedConversation={setSelectedConversation}
                  provedorId={provedorId}
                  user={user}
                />
              } />
              <Route path="reports" element={<DashboardPrincipal provedorId={provedorId} />} />
              <Route path="settings" element={<Settings provedorId={provedorId} />} />
              <Route path="users" element={<UserManagement provedorId={provedorId} />} />
              <Route path="equipes" element={<TeamsPage />} />
              <Route path="audit" element={<ConversationAudit provedorId={provedorId} />} />
              <Route path="recovery" element={<ConversationRecovery provedorId={provedorId} />} />
              <Route path="companies" element={<CompanyManagement provedorId={provedorId} />} />
              <Route path="csat" element={<CSATDashboard provedorId={provedorId} />} />
              <Route path="chatbot-manager" element={<ChatbotManager />} />
              <Route path="chatbot-builder" element={<ChatbotBuilder />} />
              <Route path="chatbot-builder/:flowId" element={<ChatbotBuilder />} />
              <Route path="planos" element={<PlanosPage provedorId={provedorId} />} />
              <Route path="respostas-rapidas" element={<RespostasRapidas provedorId={provedorId} />} />
              <Route path="integracoes" element={<Integrations provedorId={provedorId} />} />
              <Route path="perfil" element={<ProfilePage provedorId={provedorId} />} />
              <Route path="aparencia" element={<AppearancePage provedorId={provedorId} />} />
              <Route path="dados-provedor" element={<ProviderDataForm provedorId={provedorId} />} />
              <Route path="horario-provedor" element={<ProviderScheduleForm provedorId={provedorId} />} />
              <Route path="*" element={<Navigate to={`/app/accounts/${provedorId}/dashboard`} replace />} />
            </Routes>
          </div>
        </div>
      </div>
      <Changelog isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
      <RemindersModal 
        isOpen={showRemindersModal} 
        onClose={() => setShowRemindersModal(false)} 
        provedorId={provedorId}
      />
    </div>
  );
}
