from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0056_remove_systemconfig_openai_api_key_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='provedor',
            name='redes_sociais',
            field=models.JSONField(default=dict, blank=True, help_text='Redes sociais da empresa'),
        ),
    ]
