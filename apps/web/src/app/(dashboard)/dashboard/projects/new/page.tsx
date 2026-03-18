"use client";
import { useState } from "react";

const PRESETS = [
  { id: "modern-saas", name: "Modern SaaS", desc: "Next.js + tRPC + Drizzle + PostgreSQL" },
  { id: "fullstack-minimal", name: "Full-Stack Minimal", desc: "Next.js + Prisma + SQLite" },
  { id: "django-react", name: "Django + React", desc: "Django REST + React SPA" },
  { id: "rails", name: "Rails + Hotwire", desc: "Ruby on Rails full-stack" },
  { id: "go-microservices", name: "Go Microservices", desc: "Go + gRPC + PostgreSQL" },
  { id: "laravel-vue", name: "Laravel + Vue", desc: "Laravel API + Vue.js frontend" },
  { id: "react-native", name: "React Native", desc: "Expo + React Native mobile" },
  { id: "rust-backend", name: "Rust Backend", desc: "Axum + SQLx + PostgreSQL" },
  { id: "custom", name: "Custom", desc: "Define your own tech stack" },
];

export default function NewProjectPage() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("");

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Create New Project</h1>
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <span className={step >= 1 ? "text-primary font-medium" : ""}>1. Details</span>
        <span>→</span>
        <span className={step >= 2 ? "text-primary font-medium" : ""}>2. Tech Stack</span>
        <span>→</span>
        <span className={step >= 3 ? "text-primary font-medium" : ""}>3. Confirm</span>
      </div>

      {step === 1 && (
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome SaaS"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you want to build..."
              rows={4}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!name.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  preset === p.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                }`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!preset}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border p-4 space-y-2">
            <div><span className="text-sm text-muted-foreground">Name:</span> <span className="text-sm font-medium">{name}</span></div>
            <div><span className="text-sm text-muted-foreground">Stack:</span> <span className="text-sm font-medium">{PRESETS.find((p) => p.id === preset)?.name}</span></div>
            {description && <div><span className="text-sm text-muted-foreground">Description:</span> <span className="text-sm">{description}</span></div>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
              Back
            </button>
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Create Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
