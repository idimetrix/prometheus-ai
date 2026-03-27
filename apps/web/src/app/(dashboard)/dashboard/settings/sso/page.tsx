"use client";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/;

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Input,
  Label,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  CheckCircle,
  Globe,
  Key,
  Loader2,
  Lock,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface OidcConfig {
  clientId: string;
  clientSecret: string;
  discoveryEndpoint: string;
  issuerUrl: string;
}

interface SamlConfig {
  certificate: string;
  entityId: string;
  entryPointUrl: string;
}

interface GeneralConfig {
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
  requireSso: boolean;
}

export default function SsoSettingsPage() {
  const [activeTab, setActiveTab] = useState("oidc");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null
  );

  const [oidc, setOidc] = useState<OidcConfig>({
    issuerUrl: "https://accounts.google.com",
    clientId: "1234567890-abcdefghij.apps.googleusercontent.com",
    clientSecret: "",
    discoveryEndpoint:
      "https://accounts.google.com/.well-known/openid-configuration",
  });

  const [saml, setSaml] = useState<SamlConfig>({
    entryPointUrl: "https://login.microsoftonline.com/tenant-id/saml2",
    certificate: `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
RTESMBAGA1UEChMJQmFsdGltb3JlMRMwEQYDVQQLEwpDeWJlclRydXN0MSIwIAYD
VQQDExlCYWx0aW1vcmUgQ3liZXJUcnVzdCBSb290MB4XDTAwMDUxMjE4NDYwMFoX
DTI1MDUxMjIzNTkwMFowWjELMAkGA1UEBhMCSUUxEjAQBgNVBAoTCUJhbHRpbW9y
-----END CERTIFICATE-----`,
    entityId: "https://app.prometheus.dev/saml/metadata",
  });

  const [general, setGeneral] = useState<GeneralConfig>({
    requireSso: true,
    allowedDomains: ["acme.dev", "acme.com"],
    autoProvision: true,
    defaultRole: "member",
  });

  const [newDomain, setNewDomain] = useState("");

  function handleAddDomain() {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) {
      return;
    }
    if (general.allowedDomains.includes(domain)) {
      toast.error("Domain already added");
      return;
    }
    if (!DOMAIN_RE.test(domain)) {
      toast.error("Please enter a valid domain");
      return;
    }
    setGeneral((prev) => ({
      ...prev,
      allowedDomains: [...prev.allowedDomains, domain],
    }));
    setNewDomain("");
    toast.success(`Added domain: ${domain}`);
  }

  function handleRemoveDomain(domain: string) {
    setGeneral((prev) => ({
      ...prev,
      allowedDomains: prev.allowedDomains.filter((d) => d !== domain),
    }));
    toast.success(`Removed domain: ${domain}`);
  }

  function handleTestConnection() {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      if (oidc.issuerUrl && oidc.clientId) {
        setTestResult("success");
        toast.success("OIDC connection test successful");
      } else {
        setTestResult("error");
        toast.error("Connection test failed. Check your configuration.");
      }
    }, 1500);
  }

  function handleSave() {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      toast.success("SSO configuration saved successfully");
    }, 800);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">
          Single Sign-On (SSO)
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Configure SSO authentication for your workspace.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Shield className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">SSO Status</p>
              <Badge variant={general.requireSso ? "default" : "secondary"}>
                {general.requireSso ? "Enforced" : "Optional"}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Globe className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">
                Allowed Domains
              </p>
              <p className="text-muted-foreground text-sm">
                {general.allowedDomains.length} configured
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Key className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">Provider</p>
              <p className="text-muted-foreground text-sm">
                {oidc.issuerUrl.includes("google") ? "Google" : "Custom OIDC"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <TabsList>
              <TabsTrigger value="oidc">OpenID Connect</TabsTrigger>
              <TabsTrigger value="saml">SAML 2.0</TabsTrigger>
              <TabsTrigger value="general">General</TabsTrigger>
            </TabsList>

            <TabsContent className="space-y-6 pt-4" value="oidc">
              <div>
                <CardTitle className="text-base">OIDC Configuration</CardTitle>
                <CardDescription>
                  Configure OpenID Connect authentication with your identity
                  provider.
                </CardDescription>
              </div>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="oidc-issuer">Issuer URL</Label>
                  <Input
                    className="mt-1.5"
                    id="oidc-issuer"
                    onChange={(e) =>
                      setOidc((prev) => ({
                        ...prev,
                        issuerUrl: e.target.value,
                      }))
                    }
                    placeholder="https://accounts.google.com"
                    value={oidc.issuerUrl}
                  />
                  <p className="mt-1 text-muted-foreground text-xs">
                    The issuer URL of your OIDC provider (e.g., Google, Okta,
                    Auth0).
                  </p>
                </div>
                <div>
                  <Label htmlFor="oidc-client-id">Client ID</Label>
                  <Input
                    className="mt-1.5"
                    id="oidc-client-id"
                    onChange={(e) =>
                      setOidc((prev) => ({
                        ...prev,
                        clientId: e.target.value,
                      }))
                    }
                    placeholder="your-client-id"
                    value={oidc.clientId}
                  />
                </div>
                <div>
                  <Label htmlFor="oidc-client-secret">Client Secret</Label>
                  <Input
                    className="mt-1.5"
                    id="oidc-client-secret"
                    onChange={(e) =>
                      setOidc((prev) => ({
                        ...prev,
                        clientSecret: e.target.value,
                      }))
                    }
                    placeholder="your-client-secret"
                    type="password"
                    value={oidc.clientSecret}
                  />
                  <p className="mt-1 text-muted-foreground text-xs">
                    Stored encrypted. Never displayed after saving.
                  </p>
                </div>
                <div>
                  <Label htmlFor="oidc-discovery">
                    Discovery Endpoint (optional)
                  </Label>
                  <Input
                    className="mt-1.5"
                    id="oidc-discovery"
                    onChange={(e) =>
                      setOidc((prev) => ({
                        ...prev,
                        discoveryEndpoint: e.target.value,
                      }))
                    }
                    placeholder="https://.../.well-known/openid-configuration"
                    value={oidc.discoveryEndpoint}
                  />
                </div>
                <Separator />
                <div className="flex items-center gap-3">
                  <Button
                    disabled={isTesting}
                    onClick={handleTestConnection}
                    variant="outline"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Lock className="mr-2 h-4 w-4" />
                        Test Connection
                      </>
                    )}
                  </Button>
                  {testResult === "success" && (
                    <div className="flex items-center gap-1.5 text-green-500 text-sm">
                      <CheckCircle className="h-4 w-4" />
                      Connection successful
                    </div>
                  )}
                  {testResult === "error" && (
                    <div className="flex items-center gap-1.5 text-red-500 text-sm">
                      <X className="h-4 w-4" />
                      Connection failed
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent className="space-y-6 pt-4" value="saml">
              <div>
                <CardTitle className="text-base">
                  SAML 2.0 Configuration
                </CardTitle>
                <CardDescription>
                  Configure SAML-based authentication with your identity
                  provider.
                </CardDescription>
              </div>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="saml-entry">Entry Point URL</Label>
                  <Input
                    className="mt-1.5"
                    id="saml-entry"
                    onChange={(e) =>
                      setSaml((prev) => ({
                        ...prev,
                        entryPointUrl: e.target.value,
                      }))
                    }
                    placeholder="https://login.microsoftonline.com/tenant-id/saml2"
                    value={saml.entryPointUrl}
                  />
                  <p className="mt-1 text-muted-foreground text-xs">
                    The SSO URL from your SAML Identity Provider.
                  </p>
                </div>
                <div>
                  <Label htmlFor="saml-entity">Entity ID / Audience URI</Label>
                  <Input
                    className="mt-1.5"
                    id="saml-entity"
                    onChange={(e) =>
                      setSaml((prev) => ({
                        ...prev,
                        entityId: e.target.value,
                      }))
                    }
                    placeholder="https://app.prometheus.dev/saml/metadata"
                    value={saml.entityId}
                  />
                </div>
                <div>
                  <Label htmlFor="saml-cert">
                    X.509 Certificate (PEM format)
                  </Label>
                  <textarea
                    className="mt-1.5 h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                    id="saml-cert"
                    onChange={(e) =>
                      setSaml((prev) => ({
                        ...prev,
                        certificate: e.target.value,
                      }))
                    }
                    placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                    value={saml.certificate}
                  />
                  <p className="mt-1 text-muted-foreground text-xs">
                    Paste the full X.509 certificate from your Identity
                    Provider.
                  </p>
                </div>
                <Separator />
                <div className="rounded-lg border bg-muted/50 p-4">
                  <p className="font-medium text-sm">
                    Prometheus Service Provider Metadata
                  </p>
                  <div className="mt-2 space-y-1">
                    <p className="text-muted-foreground text-xs">
                      <span className="font-medium text-foreground">
                        ACS URL:
                      </span>{" "}
                      https://app.prometheus.dev/api/auth/saml/callback
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <span className="font-medium text-foreground">
                        Entity ID:
                      </span>{" "}
                      https://app.prometheus.dev/saml/metadata
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <span className="font-medium text-foreground">
                        Metadata URL:
                      </span>{" "}
                      https://app.prometheus.dev/api/auth/saml/metadata
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent className="space-y-6 pt-4" value="general">
              <div>
                <CardTitle className="text-base">
                  General SSO Settings
                </CardTitle>
                <CardDescription>
                  Configure enforcement policies and domain restrictions.
                </CardDescription>
              </div>
              <div className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium text-sm">Require SSO</p>
                    <p className="text-muted-foreground text-xs">
                      When enabled, all users must authenticate via SSO.
                      Password login is disabled.
                    </p>
                  </div>
                  <Switch
                    aria-label="Require SSO"
                    checked={general.requireSso}
                    onCheckedChange={(checked) =>
                      setGeneral((prev) => ({ ...prev, requireSso: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium text-sm">Auto-Provision Users</p>
                    <p className="text-muted-foreground text-xs">
                      Automatically create accounts for new users who
                      authenticate via SSO.
                    </p>
                  </div>
                  <Switch
                    aria-label="Auto-provision users"
                    checked={general.autoProvision}
                    onCheckedChange={(checked) =>
                      setGeneral((prev) => ({
                        ...prev,
                        autoProvision: checked,
                      }))
                    }
                  />
                </div>

                <div>
                  <Label>Allowed Email Domains</Label>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Only users with email addresses matching these domains can
                    sign in.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {general.allowedDomains.map((domain) => (
                      <Badge
                        className="flex items-center gap-1.5 py-1"
                        key={domain}
                        variant="secondary"
                      >
                        {domain}
                        <button
                          aria-label={`Remove ${domain}`}
                          className="ml-1 rounded-full hover:bg-muted"
                          onClick={() => handleRemoveDomain(domain)}
                          type="button"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Input
                      onChange={(e) => setNewDomain(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddDomain();
                        }
                      }}
                      placeholder="example.com"
                      value={newDomain}
                    />
                    <Button
                      disabled={!newDomain.trim()}
                      onClick={handleAddDomain}
                      variant="outline"
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="default-role">
                    Default Role for New Users
                  </Label>
                  <Input
                    className="mt-1.5 max-w-xs"
                    id="default-role"
                    onChange={(e) =>
                      setGeneral((prev) => ({
                        ...prev,
                        defaultRole: e.target.value,
                      }))
                    }
                    placeholder="member"
                    value={general.defaultRole}
                  />
                  <p className="mt-1 text-muted-foreground text-xs">
                    Role assigned to auto-provisioned users (e.g., member,
                    viewer).
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Separator className="my-6" />

          <div className="flex justify-end">
            <Button disabled={isSaving} onClick={handleSave}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Configuration"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
