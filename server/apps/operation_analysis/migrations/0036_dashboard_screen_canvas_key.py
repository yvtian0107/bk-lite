from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("operation_analysis", "0035_elasticsearch_source_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboard",
            name="canvas_key",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True, verbose_name="用户稳定键"),
        ),
        migrations.AddField(
            model_name="screen",
            name="canvas_key",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True, verbose_name="用户稳定键"),
        ),
    ]
