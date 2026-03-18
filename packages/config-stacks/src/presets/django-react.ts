import type { TechStackPresetExtended } from "./types";

export const DJANGO_REACT_PRESET: TechStackPresetExtended = {
  id: "django-react",
  name: "Django + React",
  description: "Django 5 REST Framework + React 19 SPA + PostgreSQL + Vite",
  languages: ["Python", "TypeScript"],
  frameworks: ["Django 5", "Django REST Framework", "React 19", "Vite"],
  database: "PostgreSQL 16",
  orm: "Django ORM",
  auth: "Django Auth + JWT",
  testing: ["pytest", "Vitest", "Playwright"],
  deployment: ["Docker", "Gunicorn", "Nginx"],
  packageManager: "pip + pnpm",
  linters: ["ruff", "ESLint"],
  icon: "snake",

  dependencies: {
    runtime: {
      django: ">=5.1,<6.0",
      djangorestframework: ">=3.15,<4.0",
      "djangorestframework-simplejwt": ">=5.3,<6.0",
      "django-cors-headers": ">=4.5,<5.0",
      "psycopg[binary]": ">=3.2,<4.0",
      gunicorn: ">=23.0,<24.0",
      "django-filter": ">=24.0,<25.0",
      "drf-spectacular": ">=0.28,<1.0",
    },
    dev: {
      pytest: ">=8.0,<9.0",
      "pytest-django": ">=4.9,<5.0",
      ruff: ">=0.8,<1.0",
      "factory-boy": ">=3.3,<4.0",
    },
  },

  fileTemplates: {
    "backend/config/settings.py":
      "Django settings with environment-based configuration",
    "backend/config/urls.py": "URL routing with DRF router registration",
    "backend/apps/core/models.py":
      "Core Django models with org-scoped base model",
    "backend/apps/core/serializers.py": "DRF serializers with validation",
    "backend/apps/core/views.py": "DRF viewsets with permission classes",
    "frontend/src/App.tsx": "React app with React Router and auth context",
    "frontend/src/api/client.ts": "Axios client with JWT interceptors",
    "docker-compose.yml": "PostgreSQL + Django + React + Nginx",
  },

  conventions: {
    routing: "Django URL conf + DRF routers for API, React Router for frontend",
    stateManagement: "React Query for server state, Context API for auth",
    apiPattern:
      "REST with DRF viewsets and serializers. OpenAPI via drf-spectacular",
    componentPattern: "Functional React components with hooks",
    styling: "Tailwind CSS with component library",
    projectStructure: "Monorepo with backend/ and frontend/ directories",
  },

  agentHints: {
    architect:
      "Design Django apps with clear model boundaries. Use DRF serializers for validation. Define REST endpoints with OpenAPI.",
    frontend_coder:
      "Use React with TypeScript. Generate API types from OpenAPI spec. Use React Query for data fetching.",
    backend_coder:
      "Write Django models with proper migrations. Use DRF viewsets and serializers. Apply permissions at viewset level.",
    test_engineer:
      "Use pytest-django for backend tests, factory-boy for fixtures. Vitest for frontend unit tests.",
    deploy_engineer:
      "Multi-stage Docker: Python backend with Gunicorn, Node frontend build served by Nginx.",
  },
};
