import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, LogOut, Activity, Plus, Edit, Trash, MessageCircle, UserPlus, Settings, X } from "lucide-react";
import { format } from "date-fns";

export default function RecentActivity() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [provedorId, setProvedorId] = useState(null);

  // Buscar provedor_id do usuário logado
  useEffect(() => {
    async function fetchUserInfo() {
      try {
        // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        const response = await fetch('/api/auth/me/', {
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          // Usar provedor_id do usuário (não mostrar atividades de outros provedores)
          if (userData.provedor_id) {
            setProvedorId(userData.provedor_id);
          } else if (userData.provedores_admin && userData.provedores_admin.length > 0) {
            // Se não tiver provedor_id direto, usar o primeiro provedor admin
            setProvedorId(userData.provedores_admin[0].id);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar informações do usuário:', error);
      }
    }
    
    fetchUserInfo();
  }, []);

  useEffect(() => {
    async function fetchActivityData() {
      if (!provedorId) {
        setLoading(false);
        return;
      }
      
      try {
        // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        
        // Buscar logs de auditoria/atividade - buscar mais logs para garantir que pegamos login/logout
        const response = await fetch(`/api/audit-logs/?limit=100&provedor_id=${provedorId}`, {
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          const allActivities = data.results || data || [];
          
          // Filtrar atividades: incluir login/logout e outras ações relevantes
          const filteredActivities = allActivities
            .filter(activity => {
              const action = (activity.action || '').toLowerCase();
              
              // PRIORIDADE: Sempre incluir login e logout
              if (action === 'login' || action === 'logout') {
                // Verificar se o usuário pertence ao provedor
                if (activity.user) {
                  let userProvedorId = null;
                  if (typeof activity.user === 'object') {
                    userProvedorId = activity.user.provedor_id;
                  } else if (typeof activity.user === 'string') {
                    // Tentar extrair provedor_id se o user for string
                    const userMatch = activity.user.match(/provedor_id[:\s]*(\d+)/i);
                    if (userMatch) {
                      userProvedorId = parseInt(userMatch[1]);
                    }
                  }
                  
                  const provedorIdNum = parseInt(provedorId);
                  // Se o usuário tem provedor_id e corresponde, incluir
                  if (userProvedorId && userProvedorId === provedorIdNum) {
                    return true;
                  }
                  // Se não tem provedor_id mas a atividade tem, verificar
                  if (!userProvedorId && activity.provedor_id) {
                    return parseInt(activity.provedor_id) === provedorIdNum;
                  }
                }
                // Se não conseguiu verificar, incluir se a atividade tem o provedor_id correto
                if (activity.provedor_id) {
                  return parseInt(activity.provedor_id) === parseInt(provedorId);
                }
                // Por segurança, incluir login/logout mesmo sem provedor_id explícito
                return true;
              }
              
              // Verificar provedor_id de diferentes formas (pode vir como número ou string)
              const activityProvedorId = activity.provedor_id;
              const provedorIdNum = parseInt(provedorId);
              const activityProvedorIdNum = activityProvedorId ? parseInt(activityProvedorId) : null;
          
              // Excluir atividades sem provedor (exceto login/logout que já foram tratados)
              if (!activityProvedorIdNum || activityProvedorIdNum !== provedorIdNum) {
                return false;
              }
              
              // Excluir atividades de usuários superadmin (garantia extra)
              if (activity.user && typeof activity.user === 'object' && activity.user.user_type === 'superadmin') {
                return false;
              }
            
            // Converter details para string se for objeto
            let details = activity.details;
            if (typeof details === 'object') {
              details = JSON.stringify(details);
            }
            details = (details || '').toLowerCase();
            
              // Incluir ações relevantes do provedor
              const relevantActions = [
                'login', 'logout', 'contact_created', 'create', 'delete', 'update', 'edit',
                'conversation_closed', 'conversation_created', 'message_sent', 'team_created',
                'user_created', 'channel_created', 'settings_updated', 'conversation_closed_agent',
                'conversation_closed_ai', 'conversation_closed_manual', 'conversation_assigned'
              ];
              
              if (relevantActions.some(act => action.includes(act))) {
              return true;
            }
            
              // Verificar se há informações relevantes nos detalhes (case insensitive)
              const detailsLower = details.toLowerCase();
              if (detailsLower.includes('equipe') || 
                  detailsLower.includes('provedor') || 
                  detailsLower.includes('canal') || 
                  detailsLower.includes('empresa') ||
                  detailsLower.includes('usuário') ||
                  detailsLower.includes('conversa') ||
                  detailsLower.includes('contato') ||
                  detailsLower.includes('criou') ||
                  detailsLower.includes('excluiu') ||
                  detailsLower.includes('atualizou') ||
                  detailsLower.includes('encerrada') ||
                  detailsLower.includes('login') ||
                  detailsLower.includes('logout')) {
              return true;
            }
            
            return false;
            })
            .slice(0, 30) // Limitar a 30 atividades mais recentes
            .sort((a, b) => {
              // Ordenar por timestamp (mais recente primeiro)
              const timeA = new Date(a.timestamp || a.created_at || a.event_at || 0);
              const timeB = new Date(b.timestamp || b.created_at || b.event_at || 0);
              return timeB - timeA;
            });
          
          setActivities(filteredActivities);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Erro ao buscar atividades:', error);
        setActivities([]);
        setLoading(false);
      }
    }

    fetchActivityData();
  }, [provedorId]);

  const getActivityIcon = (activity) => {
    const action = (activity.action || '').toLowerCase();
    
    // Converter details para string se for objeto
    let details = activity.details;
    if (typeof details === 'object') {
      details = JSON.stringify(details);
    }
    details = (details || '').toLowerCase();
    
    // Verificar primeiro se é um evento de login nos detalhes ou action
    if (details.includes('login bem-sucedido') || details.includes('tentativa de login') || 
        details.includes('usuário:') && details.includes('login') || action === 'login') {
      return <LogIn className="w-4 h-4 text-emerald-400" />;
    }
    
    // Verificar se é um evento de logout nos detalhes ou action
    if (details.includes('logout') || details.includes('saiu') || action === 'logout') {
      return <LogOut className="w-4 h-4 text-red-400" />;
    }
    
    switch (action) {
      case 'login':
        return <LogIn className="w-4 h-4 text-emerald-400" />;
      case 'logout':
        return <LogOut className="w-4 h-4 text-amber-400" />;
      case 'create':
        if (details.includes('usuário criado')) {
          return <UserPlus className="w-4 h-4 text-blue-400" />;
        } else if (details.includes('conversa')) {
          return <MessageCircle className="w-4 h-4 text-blue-400" />;
        } else if (details.includes('provedor') || details.includes('equipe') || details.includes('canal') || details.includes('empresa')) {
          return <Plus className="w-4 h-4 text-green-400" />;
        }
        return <Plus className="w-4 h-4 text-blue-400" />;
      case 'edit':
        if (details.includes('configuração')) {
          return <Settings className="w-4 h-4 text-yellow-400" />;
        }
        return <Edit className="w-4 h-4 text-yellow-400" />;
      case 'delete':
        return <Trash className="w-4 h-4 text-red-400" />;

      case 'contact_created':
        return <UserPlus className="w-4 h-4 text-purple-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getActivityText = (activity) => {
    const action = (activity.action || '').toLowerCase();
    // Extrair nome do usuário (formato: "nome (tipo)")
    const userMatch = activity.user?.match(/^([^(]+)/);
    const userName = userMatch ? userMatch[1].trim() : 'Usuário';
    
    // Tentar extrair detalhes específicos da atividade
    let details = activity.details;
    if (typeof details === 'object') {
      details = JSON.stringify(details);
    }
    details = details || '';
    
    // Verificar se há informações de login nos detalhes (case insensitive)
    if (details.toLowerCase().includes('login bem-sucedido') || details.toLowerCase().includes('tentativa de login')) {
      const userNameMatch = details.match(/usuário:\s*(\w+)/i);
      const loginUser = userNameMatch ? userNameMatch[1] : userName;
      return `${loginUser} entrou no sistema`;
    }
    
    // Verificar se há informações de logout nos detalhes (case insensitive)
    if (details.toLowerCase().includes('logout') || details.toLowerCase().includes('saiu')) {
      const userNameMatch = details.match(/usuário:\s*(\w+)/i);
      const logoutUser = userNameMatch ? userNameMatch[1] : userName;
      return `${logoutUser} saiu do sistema`;
    }
    
    switch (action) {
      case 'login':
        return `${userName} entrou no sistema`;
      case 'logout':
        return `${userName} saiu do sistema`;
      case 'create':
        // Tentar extrair o que foi criado dos detalhes
        if (details.includes('Usuário criado')) {
          const match = details.match(/Usuário criado: (\w+)/);
          const createdUser = match ? match[1] : 'usuário';
          return `${userName} criou o usuário ${createdUser}`;
        } else if (details.includes('Equipe criada') || details.includes('equipe criada')) {
          const match = details.match(/[Ee]quipe criada: (.+)/);
          const teamName = match ? match[1] : 'equipe';
          return `${userName} criou a equipe ${teamName}`;
        } else if (details.includes('Equipe excluída') || details.includes('equipe excluída')) {
          const match = details.match(/[Ee]quipe excluída: (.+)/);
          const teamName = match ? match[1] : 'equipe';
          return `${userName} excluiu a equipe ${teamName}`;
        } else if (details.includes('Contato criado')) {
          return `${userName} adicionou um novo contato`;
        } else if (details.includes('Empresa criada')) {
          const match = details.match(/Empresa criada: (.+)/);
          const companyName = match ? match[1] : 'empresa';
          return `${userName} criou a empresa ${companyName}`;
        } else if (details.includes('Provedor criado')) {
          const match = details.match(/Provedor criado: (.+)/);
          const providerName = match ? match[1] : 'provedor';
          return `${userName} criou o provedor ${providerName}`;
        } else if (details.includes('Canal criado')) {
          const match = details.match(/Canal criado: (.+)/);
          const channelName = match ? match[1] : 'canal';
          return `${userName} criou o canal ${channelName}`;
        }
        return `${userName} criou um item no sistema`;
      case 'delete':
        if (details.includes('Usuário excluído') || details.includes('Usuário removido')) {
          const match = details.match(/Usuário (?:excluído|removido): (\w+)/);
          const deletedUser = match ? match[1] : 'usuário';
          return `${userName} excluiu o usuário ${deletedUser}`;
        } else if (details.includes('Equipe excluída') || details.includes('Equipe removida')) {
          const match = details.match(/Equipe (?:excluída|removida): (.+)/);
          const teamName = match ? match[1] : 'equipe';
          return `${userName} excluiu a equipe ${teamName}`;
        } else if (details.includes('Conversa removida')) {
          return `${userName} excluiu uma conversa`;
        } else if (details.includes('Contato removido')) {
          return `${userName} excluiu um contato`;
        } else if (details.includes('Empresa excluída')) {
          const match = details.match(/Empresa excluída: (.+)/);
          const companyName = match ? match[1] : 'empresa';
          return `${userName} excluiu a empresa ${companyName}`;
        }
        return `${userName} excluiu um item do sistema`;
      case 'contact_created':
        const contactName = activity.contact_name || 'cliente';
        return `${userName} adicionou o contato ${contactName}`;
      default:
        return `${userName} executou ação no sistema`;
    }
  };

  if (loading) {
    return (
      <Card className="nc-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Atividade Recente
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">
            Nenhuma atividade recente
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-center gap-3 p-2 rounded-md bg-muted border border-border">
                <div className="shrink-0">{getActivityIcon(activity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground">
                    {getActivityText(activity)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {activity.timestamp || activity.created_at || activity.event_at
                      ? format(new Date(activity.timestamp || activity.created_at || activity.event_at), "dd/MM/yyyy HH:mm")
                      : "-"
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}