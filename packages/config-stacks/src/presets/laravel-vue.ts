import type { TechStackPresetExtended } from "./types";

export const LARAVEL_VUE_PRESET: TechStackPresetExtended = {
  id: "laravel-vue",
  name: "Laravel + Vue",
  description: "Laravel 12 API + Vue 3 + Inertia.js + Tailwind CSS",
  languages: ["PHP", "TypeScript"],
  frameworks: ["Laravel 12", "Vue 3", "Inertia.js", "Tailwind CSS"],
  database: "PostgreSQL 16",
  orm: "Eloquent",
  auth: "Laravel Sanctum",
  testing: ["PHPUnit", "Vitest", "Playwright"],
  deployment: ["Docker", "Laravel Forge", "GitHub Actions"],
  packageManager: "composer + pnpm",
  linters: ["PHP CS Fixer", "ESLint"],
  icon: "code",

  dependencies: {
    runtime: {
      "laravel/framework": "^12.0",
      "laravel/sanctum": "^4.0",
      "inertiajs/inertia-laravel": "^2.0",
      "spatie/laravel-permission": "^6.0",
      "spatie/laravel-query-builder": "^6.0",
      "spatie/laravel-data": "^4.0",
    },
    dev: {
      "phpunit/phpunit": "^11.0",
      "laravel/pint": "^1.0",
      "pestphp/pest": "^3.0",
      "larastan/larastan": "^3.0",
    },
  },

  fileTemplates: {
    "app/Models/BaseModel.php":
      "Base Eloquent model with org-scoped global scope",
    "app/Http/Controllers/Controller.php":
      "Base controller with Inertia responses",
    "routes/web.php": "Web routes with Inertia middleware",
    "resources/js/app.ts": "Vue 3 app with Inertia plugin and TypeScript",
    "resources/js/Pages/Dashboard.vue":
      "Dashboard page component with Inertia props",
    "resources/js/Layouts/AppLayout.vue": "Main layout with navigation",
    "docker-compose.yml": "PHP-FPM + Nginx + PostgreSQL + Redis",
  },

  conventions: {
    routing:
      "Laravel web routes with Inertia. API routes with Sanctum for external access",
    stateManagement:
      "Inertia shared data for global state. Vue composables for local state",
    apiPattern:
      "Inertia responses from controllers. Spatie Query Builder for filtering/sorting",
    componentPattern:
      "Vue 3 Composition API with <script setup>. Inertia page components",
    styling: "Tailwind CSS with Vue component scoping",
  },

  agentHints: {
    architect:
      "Use Inertia.js for seamless SPA feel without a separate API. Eloquent for ORM. Spatie packages for common patterns.",
    frontend_coder:
      "Write Vue 3 components with Composition API and <script setup>. Use Inertia Link and form helpers.",
    backend_coder:
      "Follow Laravel conventions. Use Form Requests for validation, Policies for authorization. Eloquent with scopes.",
    test_engineer:
      "Use Pest PHP for backend tests. Feature tests with Inertia test helpers. Vitest for Vue component tests.",
    deploy_engineer:
      "Docker with PHP-FPM and Nginx. Laravel Forge or Vapor for managed hosting. Redis for queues and sessions.",
  },
};
