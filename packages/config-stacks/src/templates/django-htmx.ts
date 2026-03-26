import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  const pyName = projectName.replace(/-/g, "_");
  return [
    {
      path: "requirements.txt",
      content: `django>=5.1,<6.0
django-htmx>=1.21,<2.0
django-extensions>=3.2,<4.0
django-environ>=0.12,<1.0
psycopg[binary]>=3.2,<4.0
gunicorn>=23.0,<24.0
whitenoise>=6.8,<7.0
django-debug-toolbar>=4.4,<5.0
pytest>=8.0,<9.0
pytest-django>=4.9,<5.0
ruff>=0.8,<1.0
`,
    },
    {
      path: "pyproject.toml",
      content: `[project]
name = "${projectName}"
version = "0.1.0"
requires-python = ">=3.12"

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "${pyName}.settings"
python_files = "tests.py test_*.py"
`,
    },
    {
      path: "manage.py",
      content: `#!/usr/bin/env python
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "${pyName}.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
`,
    },
    {
      path: `${pyName}/__init__.py`,
      content: "",
    },
    {
      path: `${pyName}/settings.py`,
      content: `import os
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(os.path.join(BASE_DIR, ".env"))

SECRET_KEY = env("SECRET_KEY", default="change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django_htmx",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django_htmx.middleware.HtmxMiddleware",
]

ROOT_URLCONF = "${pyName}.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": env.db("DATABASE_URL", default="sqlite:///db.sqlite3"),
}

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
`,
    },
    {
      path: `${pyName}/urls.py`,
      content: `from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("core.urls")),
]
`,
    },
    {
      path: `${pyName}/wsgi.py`,
      content: `import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "${pyName}.settings")
application = get_wsgi_application()
`,
    },
    {
      path: "core/__init__.py",
      content: "",
    },
    {
      path: "core/models.py",
      content: `from django.db import models


class Item(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ["-created_at"]
`,
    },
    {
      path: "core/views.py",
      content: `from django.shortcuts import render
from django.http import HttpResponse

from .models import Item


def index(request):
    items = Item.objects.all()[:20]
    return render(request, "index.html", {"items": items})


def add_item(request):
    if request.method == "POST":
        name = request.POST.get("name", "").strip()
        description = request.POST.get("description", "").strip()
        if name:
            Item.objects.create(name=name, description=description)
    items = Item.objects.all()[:20]
    return render(request, "partials/item_list.html", {"items": items})
`,
    },
    {
      path: "core/urls.py",
      content: `from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("items/add/", views.add_item, name="add_item"),
]
`,
    },
    {
      path: "core/admin.py",
      content: `from django.contrib import admin
from .models import Item

admin.site.register(Item)
`,
    },
    {
      path: "templates/base.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <script src="https://unpkg.com/htmx.org@2.0.0"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <div class="max-w-2xl mx-auto py-12 px-4">
    {% block content %}{% endblock %}
  </div>
</body>
</html>
`,
    },
    {
      path: "templates/index.html",
      content: `{% extends "base.html" %}

{% block content %}
<h1 class="text-3xl font-bold mb-8">${projectName}</h1>

<form hx-post="{% url 'add_item' %}" hx-target="#item-list" hx-swap="innerHTML" class="mb-8 space-y-3">
  {% csrf_token %}
  <input type="text" name="name" placeholder="Item name" required
    class="w-full border rounded px-3 py-2" />
  <textarea name="description" placeholder="Description"
    class="w-full border rounded px-3 py-2"></textarea>
  <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
    Add Item
  </button>
</form>

<div id="item-list">
  {% include "partials/item_list.html" %}
</div>
{% endblock %}
`,
    },
    {
      path: "templates/partials/item_list.html",
      content: `{% for item in items %}
<div class="border rounded p-4 mb-3 bg-white">
  <h3 class="font-semibold">{{ item.name }}</h3>
  {% if item.description %}
    <p class="text-gray-600 text-sm mt-1">{{ item.description }}</p>
  {% endif %}
  <span class="text-xs text-gray-400">{{ item.created_at|date:"M d, Y" }}</span>
</div>
{% empty %}
<p class="text-gray-500">No items yet. Add one above.</p>
{% endfor %}
`,
    },
    {
      path: ".env.example",
      content: `DEBUG=True
SECRET_KEY=change-me
DATABASE_URL=sqlite:///db.sqlite3
`,
    },
    {
      path: ".gitignore",
      content: `__pycache__/
*.pyc
.env
db.sqlite3
staticfiles/
.venv/
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Django + HTMX application with server-rendered HTML and dynamic interactivity.

## Getting Started

\`\`\`bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver   # http://localhost:8000
\`\`\`
`,
    },
  ];
}

export const DJANGO_HTMX_TEMPLATE: ProjectTemplate = {
  id: "django-htmx",
  name: "Django + HTMX",
  description:
    "Django server-rendered app with HTMX for dynamic interactivity, no JavaScript framework required.",
  category: "Full-Stack",
  techStack: ["Django", "HTMX", "Tailwind CSS", "PostgreSQL"],
  languages: ["Python"],
  icon: "layout",
  estimatedMinutes: 6,
  scaffoldFiles,
};
