"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SSOProtocol = "saml" | "oidc";

export interface SSOProviderConfig {
  attributeMapping: {
    email: string;
    firstName: string;
    groups: string;
    lastName: string;
  };
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  name: string;
  protocol: SSOProtocol;
  scimEnabled: boolean;
  scimToken?: string;
}

export interface ConnectionTestResult {
  details: string;
  status: "success" | "error";
}

export interface SSOConfigProps {
  onSave?: (config: SSOProviderConfig) => void;
  onTest?: (config: SSOProviderConfig) => Promise<ConnectionTestResult>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SSOProviderConfig = {
  name: "",
  protocol: "oidc",
  issuerUrl: "",
  clientId: "",
  clientSecret: "",
  attributeMapping: {
    email: "email",
    firstName: "given_name",
    lastName: "family_name",
    groups: "groups",
  },
  scimEnabled: false,
  scimToken: undefined,
};

// ---------------------------------------------------------------------------
// SSOConfig
// ---------------------------------------------------------------------------

export function SSOConfig({ onSave, onTest }: SSOConfigProps) {
  const [config, setConfig] = useState<SSOProviderConfig>(DEFAULT_CONFIG);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null
  );
  const [isTesting, setIsTesting] = useState(false);

  const updateConfig = useCallback(
    <K extends keyof SSOProviderConfig>(
      key: K,
      value: SSOProviderConfig[K]
    ) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateMapping = useCallback((field: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      attributeMapping: { ...prev.attributeMapping, [field]: value },
    }));
  }, []);

  const handleTest = useCallback(async () => {
    if (!onTest) {
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(config);
      setTestResult(result);
    } catch {
      setTestResult({ status: "error", details: "Connection test failed" });
    } finally {
      setIsTesting(false);
    }
  }, [onTest, config]);

  const handleSave = useCallback(() => {
    onSave?.(config);
  }, [onSave, config]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-semibold text-lg text-zinc-100">SSO Configuration</h2>

      {/* Protocol Selection */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-medium text-sm text-zinc-200">
          Provider Settings
        </h3>
        <div className="flex flex-col gap-4">
          <InputField
            label="Provider Name"
            onChange={(v) => updateConfig("name", v)}
            value={config.name}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm text-zinc-400" htmlFor="sso-protocol">
              Protocol
            </label>
            <div className="flex gap-2">
              {(["oidc", "saml"] as const).map((protocol) => (
                <button
                  className={`rounded px-4 py-1.5 text-sm transition-colors ${
                    config.protocol === protocol
                      ? "bg-violet-600 text-white"
                      : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                  key={protocol}
                  onClick={() => updateConfig("protocol", protocol)}
                  type="button"
                >
                  {protocol.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <InputField
            label={
              config.protocol === "oidc" ? "Issuer URL" : "SAML Metadata URL"
            }
            onChange={(v) => updateConfig("issuerUrl", v)}
            placeholder="https://..."
            value={config.issuerUrl}
          />

          <InputField
            label="Client ID"
            onChange={(v) => updateConfig("clientId", v)}
            value={config.clientId}
          />

          <InputField
            label="Client Secret"
            onChange={(v) => updateConfig("clientSecret", v)}
            type="password"
            value={config.clientSecret}
          />
        </div>
      </div>

      {/* Attribute Mapping */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-medium text-sm text-zinc-200">
          User Attribute Mapping
        </h3>
        <div className="flex flex-col gap-3">
          {(Object.entries(config.attributeMapping) as [string, string][]).map(
            ([key, value]) => (
              <InputField
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1)}
                onChange={(v) => updateMapping(key, v)}
                value={value}
              />
            )
          )}
        </div>
      </div>

      {/* SCIM Provisioning */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm text-zinc-200">
            SCIM Provisioning
          </h3>
          <button
            className={`rounded px-3 py-1 font-medium text-xs transition-colors ${
              config.scimEnabled
                ? "bg-green-500/20 text-green-300"
                : "bg-zinc-700 text-zinc-400"
            }`}
            onClick={() => updateConfig("scimEnabled", !config.scimEnabled)}
            type="button"
          >
            {config.scimEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
        {config.scimEnabled && (
          <div className="mt-3">
            <InputField
              label="SCIM Token"
              onChange={(v) => updateConfig("scimToken", v)}
              type="password"
              value={config.scimToken ?? ""}
            />
          </div>
        )}
      </div>

      {/* Connection Test */}
      {testResult && (
        <div
          className={`rounded-lg border p-4 ${
            testResult.status === "success"
              ? "border-green-500/30 bg-green-500/5"
              : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <p
            className={`font-medium text-sm ${
              testResult.status === "success"
                ? "text-green-300"
                : "text-red-300"
            }`}
          >
            {testResult.status === "success"
              ? "Connection Successful"
              : "Connection Failed"}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{testResult.details}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          disabled={isTesting}
          onClick={handleTest}
          type="button"
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <button
          className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-500"
          onClick={handleSave}
          type="button"
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  const id = `sso-${label.toLowerCase().replaceAll(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-zinc-400" htmlFor={id}>
        {label}
      </label>
      <input
        className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
        id={id}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </div>
  );
}
