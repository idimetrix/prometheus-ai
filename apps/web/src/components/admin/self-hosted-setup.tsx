"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupStep = "database" | "redis" | "llm" | "storage" | "domain";

export interface ServiceHealth {
  latencyMs?: number;
  message: string;
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
}

export interface SelfHostedConfig {
  database: {
    host: string;
    name: string;
    password: string;
    port: number;
    user: string;
  };
  domain: string;
  llmProvider: {
    apiKey: string;
    baseUrl: string;
    provider: "openai" | "anthropic" | "azure" | "custom";
  };
  redis: {
    host: string;
    password: string;
    port: number;
  };
  storage: {
    accessKey: string;
    bucket: string;
    endpoint: string;
    secretKey: string;
  };
}

export interface SelfHostedSetupProps {
  onSave?: (config: SelfHostedConfig) => void;
  serviceHealth?: ServiceHealth[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS: { key: SetupStep; label: string }[] = [
  { key: "database", label: "Database" },
  { key: "redis", label: "Redis" },
  { key: "llm", label: "LLM Provider" },
  { key: "storage", label: "Storage" },
  { key: "domain", label: "Domain" },
];

const STATUS_STYLES: Record<string, string> = {
  healthy: "bg-green-500/20 text-green-300",
  unhealthy: "bg-red-500/20 text-red-300",
  unknown: "bg-zinc-500/20 text-zinc-400",
};

const DEFAULT_CONFIG: SelfHostedConfig = {
  database: {
    host: "localhost",
    port: 5432,
    name: "prometheus",
    user: "postgres",
    password: "",
  },
  redis: { host: "localhost", port: 6379, password: "" },
  llmProvider: {
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
  },
  storage: {
    endpoint: "http://localhost:9000",
    bucket: "prometheus",
    accessKey: "",
    secretKey: "",
  },
  domain: "localhost",
};

// ---------------------------------------------------------------------------
// SelfHostedSetup
// ---------------------------------------------------------------------------

export function SelfHostedSetup({
  onSave,
  serviceHealth = [],
}: SelfHostedSetupProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>("database");
  const [config, setConfig] = useState<SelfHostedConfig>(DEFAULT_CONFIG);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  const updateField = useCallback(
    <K extends keyof SelfHostedConfig>(
      section: K,
      field: string,
      value: string | number
    ) => {
      setConfig((prev) => ({
        ...prev,
        [section]: {
          ...(prev[section] as Record<string, unknown>),
          [field]: value,
        },
      }));
    },
    []
  );

  const handleNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    const nextStep = STEPS[nextIndex];
    if (nextIndex < STEPS.length && nextStep) {
      setCurrentStep(nextStep.key);
    }
  }, [currentStepIndex]);

  const handlePrev = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    const prevStep = STEPS[prevIndex];
    if (prevIndex >= 0 && prevStep) {
      setCurrentStep(prevStep.key);
    }
  }, [currentStepIndex]);

  const handleSave = useCallback(() => {
    onSave?.(config);
  }, [onSave, config]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-semibold text-lg text-zinc-100">
        Self-Hosted Setup Wizard
      </h2>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, index) => (
          <div className="flex items-center gap-2" key={step.key}>
            <button
              className={`flex h-8 w-8 items-center justify-center rounded-full font-medium text-xs transition-colors ${
                index <= currentStepIndex
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-800 text-zinc-500"
              }`}
              onClick={() => setCurrentStep(step.key)}
              type="button"
            >
              {index + 1}
            </button>
            <span
              className={`text-sm ${index === currentStepIndex ? "text-zinc-200" : "text-zinc-500"}`}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 && (
              <div className="mx-2 h-px w-8 bg-zinc-700" />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
        {currentStep === "database" && (
          <FieldGroup title="PostgreSQL Database">
            <TextInput
              label="Host"
              onChange={(v) => updateField("database", "host", v)}
              value={config.database.host}
            />
            <TextInput
              label="Port"
              onChange={(v) => updateField("database", "port", Number(v))}
              type="number"
              value={String(config.database.port)}
            />
            <TextInput
              label="Database Name"
              onChange={(v) => updateField("database", "name", v)}
              value={config.database.name}
            />
            <TextInput
              label="User"
              onChange={(v) => updateField("database", "user", v)}
              value={config.database.user}
            />
            <TextInput
              label="Password"
              onChange={(v) => updateField("database", "password", v)}
              type="password"
              value={config.database.password}
            />
          </FieldGroup>
        )}

        {currentStep === "redis" && (
          <FieldGroup title="Redis">
            <TextInput
              label="Host"
              onChange={(v) => updateField("redis", "host", v)}
              value={config.redis.host}
            />
            <TextInput
              label="Port"
              onChange={(v) => updateField("redis", "port", Number(v))}
              type="number"
              value={String(config.redis.port)}
            />
            <TextInput
              label="Password"
              onChange={(v) => updateField("redis", "password", v)}
              type="password"
              value={config.redis.password}
            />
          </FieldGroup>
        )}

        {currentStep === "llm" && (
          <FieldGroup title="LLM Provider">
            <div className="flex flex-col gap-1">
              <label
                className="text-sm text-zinc-400"
                htmlFor="llm-provider-select"
              >
                Provider
              </label>
              <select
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
                id="llm-provider-select"
                onChange={(e) =>
                  updateField("llmProvider", "provider", e.target.value)
                }
                value={config.llmProvider.provider}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="azure">Azure OpenAI</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <TextInput
              label="API Key"
              onChange={(v) => updateField("llmProvider", "apiKey", v)}
              type="password"
              value={config.llmProvider.apiKey}
            />
            <TextInput
              label="Base URL"
              onChange={(v) => updateField("llmProvider", "baseUrl", v)}
              value={config.llmProvider.baseUrl}
            />
          </FieldGroup>
        )}

        {currentStep === "storage" && (
          <FieldGroup title="Object Storage (S3-compatible)">
            <TextInput
              label="Endpoint"
              onChange={(v) => updateField("storage", "endpoint", v)}
              value={config.storage.endpoint}
            />
            <TextInput
              label="Bucket"
              onChange={(v) => updateField("storage", "bucket", v)}
              value={config.storage.bucket}
            />
            <TextInput
              label="Access Key"
              onChange={(v) => updateField("storage", "accessKey", v)}
              value={config.storage.accessKey}
            />
            <TextInput
              label="Secret Key"
              onChange={(v) => updateField("storage", "secretKey", v)}
              type="password"
              value={config.storage.secretKey}
            />
          </FieldGroup>
        )}

        {currentStep === "domain" && (
          <FieldGroup title="Domain Configuration">
            <TextInput
              label="Domain"
              onChange={(v) => setConfig((prev) => ({ ...prev, domain: v }))}
              value={config.domain}
            />
          </FieldGroup>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <button
            className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            disabled={currentStepIndex === 0}
            onClick={handlePrev}
            type="button"
          >
            Previous
          </button>
          {currentStepIndex < STEPS.length - 1 ? (
            <button
              className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-500"
              onClick={handleNext}
              type="button"
            >
              Next
            </button>
          ) : (
            <button
              className="rounded bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-500"
              onClick={handleSave}
              type="button"
            >
              Save Configuration
            </button>
          )}
        </div>
      </div>

      {/* Service Health Dashboard */}
      {serviceHealth.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h3 className="mb-3 font-medium text-sm text-zinc-200">
            Service Health
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {serviceHealth.map((service) => (
              <div
                className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2"
                key={service.name}
              >
                <span className="text-sm text-zinc-300">{service.name}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[service.status] ?? STATUS_STYLES.unknown}`}
                >
                  {service.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldGroup({
  title,
  children,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-medium text-zinc-200">{title}</h3>
      {children}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  const id = `input-${label.toLowerCase().replaceAll(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-zinc-400" htmlFor={id}>
        {label}
      </label>
      <input
        className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
        id={id}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        value={value}
      />
    </div>
  );
}
