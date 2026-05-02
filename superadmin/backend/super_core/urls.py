from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'vps-servers', views.VpsServerViewSet, basename='vps-servers')
router.register(r'provedores', views.ProvedorViewSet, basename='provedores')
router.register(r'canais', views.CanalViewSet, basename='canais')
router.register(r'companies', views.CompanyViewSet, basename='companies')
router.register(r'users', views.UserViewSet, basename='users')
router.register(r'audit-logs', views.AuditLogViewSet, basename='audit-logs')
router.register(r'mensagens-sistema', views.MensagemSistemaViewSet, basename='mensagens-sistema')
router.register(r'billing-templates', views.BillingTemplateViewSet, basename='billing-templates')
router.register(r'system-updates', views.SystemUpdateViewSet, basename='system-updates')

urlpatterns = [
    path('auth/login/', views.LoginView.as_view(), name='auth_login'),
    path('auth/me/', views.UserMeView.as_view(), name='auth_me'),
    path('changelog/', views.changelog_view, name='changelog'),
    path('users/ping/', views.ping_view, name='users_ping'),
    path('health/', views.health_view, name='health'),
    path('system-config/', views.SystemConfigView.as_view(), name='system-config'),
    path('system-config/<int:pk>/', views.SystemConfigView.as_view(), name='system-config-detail'),
    path('', include(router.urls)),
]
