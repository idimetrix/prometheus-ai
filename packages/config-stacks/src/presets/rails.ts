import type { TechStackPresetExtended } from "./types";

export const RAILS_PRESET: TechStackPresetExtended = {
  id: "rails",
  name: "Rails + Hotwire",
  description: "Ruby on Rails 8 full-stack with Hotwire/Turbo + Stimulus",
  languages: ["Ruby", "JavaScript"],
  frameworks: ["Rails 8", "Hotwire", "Turbo", "Stimulus"],
  database: "PostgreSQL 16",
  orm: "Active Record",
  auth: "Devise",
  testing: ["RSpec", "Capybara"],
  deployment: ["Docker", "Kamal", "GitHub Actions"],
  packageManager: "bundler",
  linters: ["RuboCop", "ESLint"],
  icon: "gem",

  dependencies: {
    runtime: {
      rails: "~> 8.0",
      pg: "~> 1.5",
      devise: "~> 4.9",
      "turbo-rails": "~> 2.0",
      "stimulus-rails": "~> 1.3",
      "importmap-rails": "~> 2.0",
      redis: "~> 5.3",
      sidekiq: "~> 7.3",
      pundit: "~> 2.4",
      pagy: "~> 9.0",
    },
    dev: {
      "rspec-rails": "~> 7.1",
      capybara: "~> 3.40",
      factory_bot_rails: "~> 6.4",
      rubocop: "~> 1.69",
      "rubocop-rails": "~> 2.27",
    },
  },

  fileTemplates: {
    "app/models/application_record.rb":
      "Base model with org-scoped default scope",
    "app/controllers/application_controller.rb":
      "Base controller with Pundit authorization",
    "config/routes.rb": "RESTful routes with nested resources",
    "app/views/layouts/application.html.erb":
      "Layout with Turbo Frame and Stimulus",
    "config/database.yml": "PostgreSQL configuration with connection pooling",
    Dockerfile: "Multi-stage build with Ruby and asset pipeline",
    "config/deploy.yml": "Kamal deployment configuration",
  },

  conventions: {
    routing:
      "RESTful routes with Rails conventions. Turbo Streams for real-time updates",
    stateManagement:
      "Server-side state via Turbo Frames. Stimulus for JavaScript behavior",
    apiPattern:
      "Rails controllers with respond_to for HTML/Turbo/JSON. Pundit for authorization",
    componentPattern:
      "ViewComponents for reusable UI. Turbo Frames for partial updates",
    styling: "Tailwind CSS via importmap or cssbundling-rails",
  },

  agentHints: {
    architect:
      "Follow Rails conventions strictly. Design with RESTful resources. Use Hotwire for dynamic UI instead of API+SPA.",
    frontend_coder:
      "Use Turbo Frames and Streams for dynamic UI. Stimulus controllers for JavaScript behavior. No heavy JS framework needed.",
    backend_coder:
      "Follow Rails conventions: fat models, thin controllers. Use Active Record scopes and validations. Pundit for authorization.",
    test_engineer:
      "RSpec with request specs for APIs, system specs with Capybara for E2E. factory_bot for test data.",
    deploy_engineer:
      "Use Kamal for deployment. Multi-stage Dockerfile. Sidekiq for background jobs. Redis for caching and Action Cable.",
  },
};
