import os
import django
import sys
import json
from rest_framework.test import APIRequestFactory, force_authenticate

# Setup Django
sys.path.append('e:/niochat/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from core.models import ChatbotFlow, Provedor, User
from core.views import ChatbotFlowViewSet

factory = APIRequestFactory()
user = User.objects.get(username='demo')
view = ChatbotFlowViewSet.as_view({'get': 'list'})

request = factory.get('/api/chatbot-flows/', {'provedor': '1'})
force_authenticate(request, user=user)
response = view(request)

print(f"Status Code: {response.status_code}")
data = response.data
print(f"Total flows returned: {len(data)}")
if len(data) > 0:
    for i, flow in enumerate(data[:3]):
        print(f"Rank {i+1} | ID: {flow['id']} | Nodes: {len(flow['nodes'])} | Updated: {flow.get('updated_at')}")
else:
    print("No flows returned!")
