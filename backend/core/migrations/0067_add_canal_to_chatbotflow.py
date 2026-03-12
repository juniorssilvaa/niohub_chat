from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0066_user_volumes'),
    ]

    operations = [
        migrations.AddField(
            model_name='chatbotflow',
            name='canal',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='chatbot_flows', to='core.canal', verbose_name='Canal'),
        ),
    ]
