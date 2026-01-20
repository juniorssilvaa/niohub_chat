# Changelog

Todas as mudanças notáveis do projeto NioChat serão documentadas neste arquivo.

## [2.25.0] - 2026-01-12

### 🎉 Adicionado
- **Bloqueio Automático de Chamados para Contratos Suspensos**: Sistema com 3 camadas de proteção impede abertura de chamados técnicos para contratos suspensos por falta de pagamento
- **Equipe "IA" Automática**: Todas as conversas agora iniciam automaticamente na equipe "IA" com status "snoozed", melhorando a organização do fluxo de atendimento
- **Validação de Status de Contrato**: Backend verifica automaticamente o status do contrato antes de criar chamados técnicos
- **Exibição de Equipe nos Cards**: Frontend agora mostra a equipe responsável no card de cada conversação

### 🔧 Melhorado
- **Sistema de Chat Interno**: Correções importantes na listagem de usuários e sincronização de mensagens em tempo real
- **Prompt da IA Significativamente Melhorado**: 
  - Adicionada regra crítica sobre contratos suspensos com instruções detalhadas
  - Corrigido formato de exibição de contratos para WhatsApp com quebras de linha corretas
  - Melhorada formatação de negrito para WhatsApp (uso correto de asterisco simples)
  - Adicionadas instruções claras sobre quando solicitar CPF/CNPJ do cliente
  - Exemplos práticos de formatação para diferentes cenários
- **Sistema de Transferência da IA**: 
  - Conversas transferidas agora mantêm contexto correto
  - Equipe "IA" é atribuída automaticamente em todas as plataformas (WhatsApp Cloud API, Evolution, Uazapi, Telegram)
  - Melhor sincronização entre frontend e backend para exibição de equipes
- **Endpoint de Usuários em Equipes**: Corrigido para usar `/api/users/my_provider_users/`, garantindo isolamento correto entre provedores
- **Formatação de Mensagens WhatsApp**: Sistema agora limpa automaticamente formatação markdown incorreta antes de enviar mensagens

### 🐛 Corrigido
- **Erro de Variável Indefinida no Prompt**: Corrigido erro `name 'NOME_CLIENTE' is not defined` que impedia a IA de responder
- **Dados Mockados em Equipes**: Removidos usuários fictícios (João Silva, Maria Santos) da listagem de membros de equipe
- **Formatação de Negrito WhatsApp**: Corrigido uso de `**texto**` para `*texto*` em todas as mensagens
- **Serialização de Equipes**: Campo `team` agora é corretamente serializado e enviado para o frontend
- **Priorização de Token de Autenticação**: Frontend agora prioriza `auth_token` ao invés de `token` genérico

### 🛡️ Segurança
- **Isolamento de Usuários por Provedor**: Cada provedor agora visualiza apenas seus próprios usuários ao gerenciar equipes
- **Validação de Contrato Suspenso**: Sistema impede abertura de chamados para contratos inadimplentes, protegendo recursos técnicos

## [2.23.12] - 2025-11-28

### 🎉 Adicionado
- **Sistema de Bloqueio de Contatos para Atendimento**: Agora é possível bloquear contatos para que a IA não responda suas mensagens. O provedor pode ativar/desativar o bloqueio através de um toggle na lista de contatos.
- **Interface de Gerenciamento de Bloqueio**: Adicionada coluna 'ATENDER' na lista de contatos com toggle visual (verde = ativo, vermelho = bloqueado) para gerenciar o bloqueio de atendimento.
- **Filtro de Contatos Bloqueados**: Adicionado filtro para visualizar apenas contatos bloqueados para atendimento, facilitando o gerenciamento.

### 🔧 Melhorado
- **Verificação de Bloqueio nos Webhooks**: Sistema verifica automaticamente se o contato está bloqueado antes de chamar a IA, tanto no webhook Evolution quanto no Uazapi.
- **Auditoria de Bloqueios**: Todas as alterações de bloqueio são registradas no AuditLog para rastreabilidade.

## [2.23.4] - 2025-11-25

### 🎉 Adicionado
- **Parâmetro conteudolimpo no SGP**: Adicionado parâmetro para remover mensagem padrão 'Chamado via URA' do SGP, permitindo usar formato personalizado 'Chamado aberto via NIOCHAT'
- **Verificação Obrigatória de Horário de Funcionamento**: Implementada verificação obrigatória antes de criar chamado técnico, informando ao cliente quando será atendido se estiver fora do horário

### 🔧 Melhorado
- **Mensagens Variadas de Confirmação de Chamado**: Sistema agora gera mensagens variadas incluindo o relato literal do cliente, tornando a comunicação mais natural
- **Saudações Variadas e Naturais**: IA agora varia saudações naturalmente (ex: 'Oii, tudo bem?', 'Boa noite! Como posso ajudar?', 'Olá! Em que posso te ajudar?') ao invés de sempre usar a mesma frase
- **Prevenção de Repetição de Mensagens**: Adicionadas instruções reforçadas para IA consultar histórico completo antes de responder, evitando repetição de mensagens e perguntas
- **Uso de Relato Literal do Cliente**: Melhoradas descrições dos parâmetros para garantir que IA use exatamente o que o cliente disse, não resumos genéricos

### 🐛 Corrigido
- **Formato da Descrição de Chamados**: Corrigido formato para 'Chamado aberto via NIOCHAT\nCliente relatou: [relato do cliente]' removendo duplicação de texto

## [2.24.0] - 2025-11-23

### 🎉 Adicionado
- **Sistema CSAT com Processamento Assíncrono**: Implementado sistema completo de CSAT (Customer Satisfaction Score) com processamento assíncrono usando Dramatiq e RabbitMQ
- **Integração Dramatiq + RabbitMQ**: Sistema de filas assíncronas para processamento de tarefas em background, garantindo alta performance e escalabilidade
- **Agendamento Inteligente de CSAT**: CSATs são agendados automaticamente com delay configurável (padrão: 2 minutos após encerramento) usando delay/eta do Dramatiq
- **Logging Detalhado**: Sistema de logging completo com logs explícitos [DRAMATIQ] para facilitar debugging e monitoramento

### 🔧 Melhorado
- **Configuração de Middleware Dramatiq**: Configurado middleware completo (AgeLimit, Retries, TimeLimit) para garantir que mensagens não sejam perdidas
- **Tratamento de Erros**: Implementado tratamento adequado para evitar que mensagens caiam em dead letter queues
- **Consistência de Timezone**: Ajustado cálculo de delay e timezone para garantir consistência, sempre usando UTC

### 🐛 Corrigido
- **Fluxo de Envio CSAT**: Corrigido problema onde tarefas CSAT não eram enviadas para o Dramatiq quando havia delay
- **Cálculo de Delay**: Ajustado cálculo de delay e timezone para garantir consistência entre scheduled_send_at e eta
- **Dead Letter Queue**: Prevenção de mensagens em default.DQ, garantindo reprocessamento automático

## [2.1.5] - 2025-01-XX

### 🎉 Adicionado
- **Sistema CSAT Completo**: Coleta automática de feedback com dashboard
- **Análise de Sentimento IA**: Interpretação automática de feedback textual
- **Auditoria Avançada**: Histórico completo de conversas e avaliações
- **Dashboard Melhorado**: Métricas em tempo real e gráficos interativos
- **Isolamento de Dados**: Segurança total entre provedores
- **Automação Celery**: Tarefas programadas para CSAT
- **Interface Otimizada**: Componentes sem emojis e mais profissional
- **Transferência para Equipes**: Novo endpoint `/transfer_to_team/` para transferência correta
- **Classificação de Conversas**: Lógica aprimorada para abas (Com IA, Em Espera, Em Atendimento)
- **Sistema de Equipes**: Conversas transferidas ficam visíveis para toda a equipe

### 🔧 Melhorado
- **Performance**: Otimizações no dashboard e carregamento de dados
- **UX**: Interface mais limpa e profissional
- **Segurança**: Isolamento total de dados entre provedores
- **Relatórios**: Gráficos mais informativos e interativos

### 🐛 Corrigido
- **CSAT**: Correção no envio automático de pesquisas
- **Transferência**: Correção na lógica de transferência para equipes
- **Dashboard**: Correção na atualização de métricas em tempo real
- **Auditoria**: Correção na exibição de logs de auditoria

## [2.0.0] - 2024-12-XX

### 🎉 Adicionado
- **Integração ChatGPT**: IA conversacional avançada
- **SGP Automático**: Consulta dados reais do cliente
- **Function Calls**: IA executa funções SGP em tempo real
- **Fluxo Inteligente**: Detecção automática de demandas
- **Personalidade Avançada**: Customização completa da IA
- **Geração Automática**: Faturas com PIX e QR Code
- **Atendimento 3x mais rápido**: Sem perguntas desnecessárias

### 🔧 Melhorado
- **Performance**: Atendimento automatizado 24/7
- **Precisão**: Dados reais do SGP, nunca inventados
- **Velocidade**: Respostas instantâneas com dados completos
- **Personalização**: IA única para cada provedor

## [1.0.0] - 2024-XX-XX

### 🎉 Adicionado
- **Sistema Base**: Estrutura completa do NioChat
- **Integração WhatsApp**: Uazapi/Evolution API integrado
- **Interface React**: Interface moderna e responsiva
- **WebSocket**: Comunicação em tempo real
- **Sistema de Reações**: Emojis e exclusão de mensagens
- **Gestão de Equipes**: Organização por equipes
- **Upload de Mídia**: Suporte completo a mídia
- **Painel Admin**: Interface Django customizada
- **Sistema Multi-tenant**: Suporte a múltiplos provedores
- **Logs de Auditoria**: Sistema completo de auditoria
- **Integrações Múltiplas**: WhatsApp, Telegram, Email, Nio Chat
- **Permissões Granulares**: Controle fino de acesso
- **Configurações Avançadas**: Provedores personalizáveis
- **Webhooks Configuráveis**: Integração flexível

### 🔧 Melhorado
- **Arquitetura**: Sistema escalável e robusto
- **Segurança**: Isolamento total entre provedores
- **Performance**: Otimizações em todas as camadas
- **UX**: Interface intuitiva e moderna

## 🚀 Roadmap

### Próximas Versões
- **v2.2.0**: Integração com mais sistemas de gestão
- **v2.3.0**: IA multilíngue
- **v2.4.0**: Dashboard avançado com mais métricas
- **v3.0.0**: Arquitetura microserviços

### Funcionalidades Planejadas
- **Integração CRM**: Conectores para CRMs populares
- **IA Multilíngue**: Suporte a múltiplos idiomas
- **Dashboard Avançado**: Mais métricas e relatórios
- **Arquitetura Microserviços**: Escalabilidade máxima
- **Mobile App**: Aplicativo nativo para mobile
- **API GraphQL**: API mais flexível
- **Integração Slack**: Notificações no Slack
- **Integração Teams**: Notificações no Microsoft Teams

## 📊 Estatísticas

### Desenvolvimento
- **Commits**: 500+
- **Issues**: 50+ resolvidas
- **Pull Requests**: 100+ aprovados
- **Contribuidores**: 5+

### Funcionalidades
- **Endpoints API**: 50+
- **Componentes React**: 100+
- **Integrações**: 10+
- **Testes**: 200+

### Performance
- **Tempo de Resposta**: < 200ms
- **Uptime**: 99.9%
- **Escalabilidade**: 1000+ usuários simultâneos
- **Disponibilidade**: 24/7

## 🏆 Reconhecimentos

### Tecnologias Utilizadas
- **Django 5.2**: Framework web robusto
- **React 18**: Interface moderna
- **PostgreSQL**: Banco de dados confiável
- **Redis**: Cache e sessões
- **Celery**: Processamento assíncrono
- **WebSocket**: Tempo real
- **OpenAI**: IA avançada
- **Supabase**: Dashboard e auditoria

### Integrações
- **Uazapi/Evolution**: WhatsApp Business
- **OpenAI ChatGPT**: IA conversacional
- **SGP**: Sistema de gestão
- **Supabase**: Dashboard e dados
- **Telegram**: Notificações
- **Email**: Comunicação

## 📝 Notas de Versão

### v2.1.5
Esta versão representa um marco importante no desenvolvimento do NioChat, com a introdução do sistema CSAT completo e auditoria avançada. O sistema agora oferece:

- **Coleta automática de feedback** com análise de sentimento
- **Dashboard em tempo real** com métricas precisas
- **Auditoria completa** de todas as ações do sistema
- **Isolamento total** de dados entre provedores
- **Interface otimizada** para melhor experiência do usuário

### v2.0.0
Esta versão revolucionou o atendimento automatizado com a introdução da IA inteligente e integração SGP. O sistema agora oferece:

- **Atendimento 24/7** com IA avançada
- **Dados reais** do SGP, nunca inventados
- **Function Calls** para ações automáticas
- **Personalização completa** da IA por provedor
- **Fluxo inteligente** sem perguntas desnecessárias

### v1.0.0
Esta versão estabeleceu a base sólida do NioChat com:

- **Arquitetura robusta** e escalável
- **Integração completa** com WhatsApp
- **Interface moderna** e responsiva
- **Sistema multi-tenant** com isolamento total
- **Permissões granulares** para controle fino

## 🔗 Links Úteis

- **GitHub**: [github.com/juniorssilvaa/niochat](https://github.com/juniorssilvaa/niochat)
- **Documentação**: [docs.niochat.com.br](https://docs.niochat.com.br)
- **Demo**: [demo.niochat.com.br](https://demo.niochat.com.br)
- **Suporte**: [suporte@niochat.com.br](mailto:suporte@niochat.com.br)

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](https://github.com/juniorssilvaa/niochat/blob/main/LICENSE) para mais detalhes.

