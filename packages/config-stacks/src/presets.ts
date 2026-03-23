export interface TechStackPreset {
  auth: string;
  database: string;
  deployment: string[];
  description: string;
  frameworks: string[];
  icon: string;
  id: string;
  languages: string[];
  linters: string[];
  name: string;
  orm: string;
  packageManager: string;
  testing: string[];
}

export const TECH_STACK_PRESETS: Record<string, TechStackPreset> = {
  "modern-saas": {
    id: "modern-saas",
    name: "Modern SaaS",
    description:
      "Next.js + tRPC + Drizzle + PostgreSQL + Redis + Clerk + Stripe",
    languages: ["TypeScript"],
    frameworks: ["Next.js 16", "React 19", "tRPC v11", "Tailwind CSS 4"],
    database: "PostgreSQL 16",
    orm: "Drizzle ORM",
    auth: "Clerk",
    testing: ["Vitest", "Playwright", "Testing Library"],
    deployment: ["Docker", "k3s", "GitHub Actions"],
    packageManager: "pnpm",
    linters: ["ESLint", "Prettier"],
    icon: "rocket",
  },
  "fullstack-minimal": {
    id: "fullstack-minimal",
    name: "Full-Stack Minimal",
    description: "Next.js + Prisma + SQLite/PostgreSQL + NextAuth",
    languages: ["TypeScript"],
    frameworks: ["Next.js 16", "React 19", "Tailwind CSS 4"],
    database: "SQLite / PostgreSQL",
    orm: "Prisma",
    auth: "NextAuth.js",
    testing: ["Vitest", "Testing Library"],
    deployment: ["Vercel", "GitHub Actions"],
    packageManager: "pnpm",
    linters: ["ESLint", "Prettier"],
    icon: "zap",
  },
  "django-react": {
    id: "django-react",
    name: "Django + React",
    description: "Django REST Framework + React SPA + PostgreSQL",
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
  },
  rails: {
    id: "rails",
    name: "Rails + Hotwire",
    description: "Ruby on Rails full-stack with Hotwire/Turbo",
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
  },
  "go-microservices": {
    id: "go-microservices",
    name: "Go Microservices",
    description: "Go + gRPC + PostgreSQL + Redis",
    languages: ["Go"],
    frameworks: ["Go stdlib", "gRPC", "Chi router"],
    database: "PostgreSQL 16",
    orm: "sqlc",
    auth: "JWT",
    testing: ["Go testing", "testify"],
    deployment: ["Docker", "k3s", "GitHub Actions"],
    packageManager: "go modules",
    linters: ["golangci-lint"],
    icon: "server",
  },
  "laravel-vue": {
    id: "laravel-vue",
    name: "Laravel + Vue",
    description: "Laravel API + Vue.js + Inertia.js",
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
  },
  "react-native": {
    id: "react-native",
    name: "React Native",
    description: "Expo + React Native + TypeScript",
    languages: ["TypeScript"],
    frameworks: ["Expo", "React Native", "React Navigation"],
    database: "SQLite (local) + Supabase (cloud)",
    orm: "Drizzle ORM",
    auth: "Supabase Auth",
    testing: ["Jest", "Detox"],
    deployment: ["EAS Build", "App Store", "Play Store"],
    packageManager: "pnpm",
    linters: ["ESLint", "Prettier"],
    icon: "smartphone",
  },
  "rust-backend": {
    id: "rust-backend",
    name: "Rust Backend",
    description: "Axum + SQLx + PostgreSQL",
    languages: ["Rust"],
    frameworks: ["Axum", "Tokio", "Tower"],
    database: "PostgreSQL 16",
    orm: "SQLx",
    auth: "JWT + argon2",
    testing: ["cargo test", "reqwest"],
    deployment: ["Docker", "GitHub Actions"],
    packageManager: "cargo",
    linters: ["clippy", "rustfmt"],
    icon: "shield",
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "Define your own tech stack from scratch",
    languages: [],
    frameworks: [],
    database: "",
    orm: "",
    auth: "",
    testing: [],
    deployment: [],
    packageManager: "",
    linters: [],
    icon: "settings",
  },
};

export function getPreset(id: string): TechStackPreset | undefined {
  return TECH_STACK_PRESETS[id];
}
