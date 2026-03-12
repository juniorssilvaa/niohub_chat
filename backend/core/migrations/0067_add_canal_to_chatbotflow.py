from django.db import migrations, models
import django.db.models.deletion


def add_canal_if_not_exists(apps, schema_editor):
    table = 'core_chatbotflow'
    column = 'canal_id'
    
    # Check if column exists using cursor
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = %s AND column_name = %s)",
            [table, column]
        )
        exists = cursor.fetchone()[0]
    
    if not exists:
        migrations.AddField(
            model_name='chatbotflow',
            name='canal',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='chatbot_flows', to='core.canal', verbose_name='Canal'),
        ).database_forwards('core', schema_editor, apps, apps)

class Migration(migrations.Migration):

    dependencies = [
        ('core', '0066_user_volumes'),
    ]

    operations = [
        migrations.RunPython(add_canal_if_not_exists, reverse_code=migrations.RunPython.noop),
    ]
