import { FormEvent, useEffect, useState } from "react";
import {
  Copy,
  KeyRound,
  MessageCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { apiFetch, API_BASE_URL } from "./lib/api";

type IntegrationSecretResponse = {
  companyId: string;
  webhookSecret: string;
};

type WhatsAppIntegrationConfig = {
  whatsappProviderMode: "mock" | "cloud";
  whatsappPhoneNumberId: string;
  whatsappAccessTokenSet: boolean;
  whatsappAccessTokenPreview: string;
  whatsappBusinessAccountId: string;
  whatsappGraphApiVersion: string;
  whatsappWebhookVerifyToken: string;
};

type WhatsAppIntegrationResponse = {
  message?: string;
  config: WhatsAppIntegrationConfig;
};

type TestSendResponse = {
  message: string;
  result: {
    provider: "mock" | "cloud";
    providerMessageId: string;
    raw?: unknown;
  };
};

export default function IntegrationsPage() {
  const [companyId, setCompanyId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [whatsappProviderMode, setWhatsappProviderMode] =
    useState<"mock" | "cloud">("mock");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState("");
  const [whatsappAccessToken, setWhatsappAccessToken] = useState("");
  const [whatsappAccessTokenPreview, setWhatsappAccessTokenPreview] =
    useState("");
  const [whatsappAccessTokenSet, setWhatsappAccessTokenSet] = useState(false);
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] =
    useState("");
  const [whatsappGraphApiVersion, setWhatsappGraphApiVersion] =
    useState("v20.0");
  const [whatsappWebhookVerifyToken, setWhatsappWebhookVerifyToken] = useState(
    "airadesk_verify_token"
  );

  const [testTo, setTestTo] = useState("+91 ");
  const [testBody, setTestBody] = useState(
    "Hi, this is a test WhatsApp message from AiraDesk."
  );

  const [loading, setLoading] = useState(true);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [testingRealSend, setTestingRealSend] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [testingCall, setTestingCall] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const whatsappWebhookUrl = `${API_BASE_URL}/api/webhooks/whatsapp/inbound`;
  const metaWhatsAppWebhookUrl = `${API_BASE_URL}/api/webhooks/meta/whatsapp`;
  const callWebhookUrl = `${API_BASE_URL}/api/webhooks/calls/inbound`;

  function applyWhatsAppConfig(config: WhatsAppIntegrationConfig) {
    setWhatsappProviderMode(config.whatsappProviderMode || "mock");
    setWhatsappPhoneNumberId(config.whatsappPhoneNumberId || "");
    setWhatsappAccessToken("");
    setWhatsappAccessTokenSet(Boolean(config.whatsappAccessTokenSet));
    setWhatsappAccessTokenPreview(config.whatsappAccessTokenPreview || "");
    setWhatsappBusinessAccountId(config.whatsappBusinessAccountId || "");
    setWhatsappGraphApiVersion(config.whatsappGraphApiVersion || "v20.0");
    setWhatsappWebhookVerifyToken(
      config.whatsappWebhookVerifyToken || "airadesk_verify_token"
    );
  }

  async function loadIntegrations() {
    try {
      setError("");
      setLoading(true);

      const [secretData, whatsappData] = await Promise.all([
        apiFetch<IntegrationSecretResponse>("/api/integrations/secret"),
        apiFetch<WhatsAppIntegrationResponse>("/api/whatsapp-integration"),
      ]);

      setCompanyId(secretData.companyId);
      setWebhookSecret(secretData.webhookSecret);
      applyWhatsAppConfig(whatsappData.config);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load integrations"
      );
    } finally {
      setLoading(false);
    }
  }

  async function rotateSecret() {
    try {
      setRotating(true);
      setError("");
      setMessage("");

      const data = await apiFetch<IntegrationSecretResponse>(
        "/api/integrations/secret/rotate",
        {
          method: "POST",
        }
      );

      setCompanyId(data.companyId);
      setWebhookSecret(data.webhookSecret);
      setMessage("Webhook secret rotated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate secret");
    } finally {
      setRotating(false);
    }
  }

  async function saveWhatsAppIntegration(event: FormEvent) {
    event.preventDefault();

    try {
      setSavingWhatsapp(true);
      setError("");
      setMessage("");

      const payload: Record<string, string> = {
        whatsappProviderMode,
        whatsappPhoneNumberId: whatsappPhoneNumberId.trim(),
        whatsappBusinessAccountId: whatsappBusinessAccountId.trim(),
        whatsappGraphApiVersion: whatsappGraphApiVersion.trim() || "v20.0",
        whatsappWebhookVerifyToken:
          whatsappWebhookVerifyToken.trim() || "airadesk_verify_token",
      };

      if (whatsappAccessToken.trim()) {
        payload.whatsappAccessToken = whatsappAccessToken.trim();
      }

      const data = await apiFetch<WhatsAppIntegrationResponse>(
        "/api/whatsapp-integration",
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );

      applyWhatsAppConfig(data.config);
      setMessage("WhatsApp integration saved.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save WhatsApp integration"
      );
    } finally {
      setSavingWhatsapp(false);
    }
  }

  async function testRealWhatsAppSend(event: FormEvent) {
    event.preventDefault();

    try {
      setTestingRealSend(true);
      setError("");
      setMessage("");

      const data = await apiFetch<TestSendResponse>(
        "/api/whatsapp-integration/test-send",
        {
          method: "POST",
          body: JSON.stringify({
            to: testTo.trim(),
            body: testBody.trim(),
          }),
        }
      );

      setMessage(
        `WhatsApp test processed through ${data.result.provider}. Provider ID: ${data.result.providerMessageId}`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send WhatsApp test"
      );
    } finally {
      setTestingRealSend(false);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Copied to clipboard.");
  }

  async function testWhatsapp(event: FormEvent) {
    event.preventDefault();

    try {
      setTestingWhatsapp(true);
      setError("");
      setMessage("");

      const response = await fetch(whatsappWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-airadesk-company-id": companyId,
          "x-airadesk-secret": webhookSecret,
        },
        body: JSON.stringify({
          customerName: "Test WhatsApp Customer",
          customerPhone: "+91 90000 33333",
          message: "Hi, I want to know your appointment timing.",
          intent: "test_whatsapp_enquiry",
          aiSummary: "Test WhatsApp enquiry created from Integrations page.",
          priority: "MEDIUM",
          humanNeeded: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "WhatsApp webhook test failed");
      }

      setMessage("Test WhatsApp conversation created. Check Inbox.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to test WhatsApp webhook"
      );
    } finally {
      setTestingWhatsapp(false);
    }
  }

  async function testCall(event: FormEvent) {
    event.preventDefault();

    try {
      setTestingCall(true);
      setError("");
      setMessage("");

      const response = await fetch(callWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-airadesk-company-id": companyId,
          "x-airadesk-secret": webhookSecret,
        },
        body: JSON.stringify({
          customerName: "Test Urgent Call",
          customerPhone: "+91 90000 44444",
          transcript:
            "Customer says this is urgent and wants staff to call back immediately.",
          durationSeconds: 41,
          status: "TRANSFERRED",
          intent: "urgent_test_call",
          aiSummary:
            "Test urgent call created from Integrations page. Staff follow-up required.",
          priority: "HIGH",
          humanNeeded: true,
          taskTitle: "Test urgent call follow-up",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Call webhook test failed");
      }

      setMessage("Test call and task created. Check Inbox and Tasks.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test call webhook");
    } finally {
      setTestingCall(false);
    }
  }

  useEffect(() => {
    loadIntegrations();
  }, []);

  if (loading) {
    return (
      <section className="flex min-h-[calc(100vh-120px)] items-center justify-center">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-5 text-sm text-white/60">
          Loading integrations...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-6 md:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium text-white/55">
              <Webhook size={14} />
              Integrations
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              Connect WhatsApp, calls and external AI tools.
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-white/50 md:text-base md:leading-7">
              Configure Meta WhatsApp Cloud API, secure webhooks, call provider
              webhooks and test delivery directly from the dashboard.
            </p>
          </div>

          <button
            onClick={loadIntegrations}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-sm text-white/70 hover:text-white"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_430px]">
        <div className="space-y-5">
          <Panel
            icon={<MessageCircle size={21} />}
            title="Meta WhatsApp Cloud API"
            subtitle="Save phone number ID, access token, provider mode and test sending."
          >
            <form onSubmit={saveWhatsAppIntegration} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Provider Mode">
                  <select
                    value={whatsappProviderMode}
                    onChange={(event) =>
                      setWhatsappProviderMode(
                        event.target.value as "mock" | "cloud"
                      )
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  >
                    <option value="mock" className="bg-[#05070d]">
                      Mock
                    </option>
                    <option value="cloud" className="bg-[#05070d]">
                      Cloud API
                    </option>
                  </select>
                </Field>

                <Field label="Graph API Version">
                  <input
                    value={whatsappGraphApiVersion}
                    onChange={(event) =>
                      setWhatsappGraphApiVersion(event.target.value)
                    }
                    className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                    placeholder="v20.0"
                  />
                </Field>
              </div>

              <Field label="Phone Number ID">
                <input
                  value={whatsappPhoneNumberId}
                  onChange={(event) =>
                    setWhatsappPhoneNumberId(event.target.value)
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder="Meta phone_number_id"
                />
              </Field>

              <Field label="WhatsApp Business Account ID optional">
                <input
                  value={whatsappBusinessAccountId}
                  onChange={(event) =>
                    setWhatsappBusinessAccountId(event.target.value)
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder="WABA ID"
                />
              </Field>

              <Field
                label={
                  whatsappAccessTokenSet
                    ? `Access Token saved: ${whatsappAccessTokenPreview}`
                    : "Access Token"
                }
              >
                <input
                  value={whatsappAccessToken}
                  onChange={(event) =>
                    setWhatsappAccessToken(event.target.value)
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder={
                    whatsappAccessTokenSet
                      ? "Leave empty to keep existing token"
                      : "Paste Meta access token"
                  }
                />
              </Field>

              <Field label="Webhook Verify Token">
                <input
                  value={whatsappWebhookVerifyToken}
                  onChange={(event) =>
                    setWhatsappWebhookVerifyToken(event.target.value)
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                  placeholder="airadesk_verify_token"
                />
              </Field>

              <button
                type="submit"
                disabled={savingWhatsapp}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                {savingWhatsapp ? "Saving..." : "Save WhatsApp integration"}
              </button>
            </form>
          </Panel>

          <Panel
            icon={<Webhook size={21} />}
            title="Webhook URLs"
            subtitle="Use Meta webhook for real WhatsApp and custom webhook for local/provider tests."
          >
            <div className="space-y-4">
              <CopyBox
                label="Meta WhatsApp Webhook URL"
                value={metaWhatsAppWebhookUrl}
                onCopy={copyText}
              />

              <CopyBox
                label="Custom WhatsApp Webhook URL"
                value={whatsappWebhookUrl}
                onCopy={copyText}
              />

              <CopyBox
                label="Call Webhook URL"
                value={callWebhookUrl}
                onCopy={copyText}
              />
            </div>
          </Panel>

          <Panel
            icon={<KeyRound size={21} />}
            title="Custom Webhook Authentication"
            subtitle="Every custom webhook request must include these two headers."
          >
            <div className="space-y-4">
              <CopyBox
                label="x-airadesk-company-id"
                value={companyId}
                onCopy={copyText}
              />

              <CopyBox
                label="x-airadesk-secret"
                value={webhookSecret}
                onCopy={copyText}
                secret
              />

              <button
                onClick={rotateSecret}
                disabled={rotating}
                className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={16} />
                {rotating ? "Rotating..." : "Rotate secret"}
              </button>
            </div>
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel
            icon={<Send size={21} />}
            title="Test Real WhatsApp Send"
            subtitle="Uses saved integration config. Mock mode will not send real WhatsApp."
          >
            <form onSubmit={testRealWhatsAppSend} className="space-y-3">
              <input
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-sm outline-none"
                placeholder="+91..."
              />

              <textarea
                value={testBody}
                onChange={(event) => setTestBody(event.target.value)}
                className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none"
              />

              <button
                type="submit"
                disabled={testingRealSend || !testTo.trim() || !testBody.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={16} />
                {testingRealSend ? "Sending..." : "Send WhatsApp test"}
              </button>
            </form>
          </Panel>

          <Panel
            icon={<Send size={21} />}
            title="Test Webhooks"
            subtitle="Create test records directly inside the CRM."
          >
            <form onSubmit={testWhatsapp}>
              <button
                type="submit"
                disabled={testingWhatsapp}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageCircle size={16} />
                {testingWhatsapp ? "Testing..." : "Send test WhatsApp webhook"}
              </button>
            </form>

            <form onSubmit={testCall} className="mt-3">
              <button
                type="submit"
                disabled={testingCall}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 text-sm font-medium text-white hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Phone size={16} />
                {testingCall ? "Testing..." : "Send test urgent call"}
              </button>
            </form>
          </Panel>

          <Panel
            icon={<ShieldCheck size={21} />}
            title="Setup Notes"
            subtitle="Important for real client use."
          >
            <div className="space-y-3 text-sm leading-6 text-white/55">
              <p>
                Use <span className="text-white">Mock</span> mode while
                developing. Use <span className="text-white">Cloud API</span>{" "}
                only after adding a valid Meta token and phone number ID.
              </p>

              <p>
                For local MVP this stores the token in database. In production,
                encrypt access tokens before saving them.
              </p>

              <p>
                Put the Meta webhook URL and verify token into your Meta app
                webhook configuration.
              </p>
            </div>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <p className="mb-2 text-sm text-white/45">{label}</p>
      {children}
    </label>
  );
}

function Panel({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black">
          {icon}
        </div>

        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em]">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-white/40">{subtitle}</p>
        </div>
      </div>

      {children}
    </div>
  );
}

function CopyBox({
  label,
  value,
  onCopy,
  secret,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
  secret?: boolean;
}) {
  const visibleValue =
    secret && value
      ? `${value.slice(0, 10)}...${value.slice(-8)}`
      : value || "-";

  return (
    <div>
      <p className="mb-2 text-sm text-white/45">{label}</p>

      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
        <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-3 text-xs text-white/65">
          {visibleValue}
        </code>

        <button
          type="button"
          onClick={() => onCopy(value)}
          disabled={!value}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
}