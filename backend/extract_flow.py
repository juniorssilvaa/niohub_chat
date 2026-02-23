import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from core.models import ChatbotFlow

flow = ChatbotFlow.objects.order_by('-updated_at').first()
if flow:
    output = {
        'id': flow.id,
        'edges': flow.edges,
        'nodes': flow.nodes
    }
    with open('flow_data.json', 'w') as f:
        json.dump(output, f, indent=2)
    print(f"DONE: Flow {flow.id}")
else:
    print("No flow found")
