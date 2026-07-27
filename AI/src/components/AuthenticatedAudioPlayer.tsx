import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { API_BASE_URL } from "../lib/api";

export function AuthenticatedAudioPlayer({
  url,
  label = "Call recording",
}: {
  url: string;
  label?: string;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusKind, setStatusKind] = useState<
    "preparing" | "failed" | "unavailable" | null
  >(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let revoked = false;
    let currentUrl = "";
    const requestId = ++requestIdRef.current;

    async function loadAudio() {
      if (!url) {
        setLoading(false);
        setStatusKind("unavailable");
        setError("Recording unavailable.");
        return;
      }

      if (/^https?:/i.test(url) && !url.includes("api.twilio.com")) {
        if (!revoked && requestId === requestIdRef.current) {
          setBlobUrl(url);
          setLoading(false);
          setError("");
          setStatusKind(null);
        }
        return;
      }

      try {
        setLoading(true);
        setError("");
        setStatusKind(null);

        const token = localStorage.getItem("airadesk_token");
        const response = await fetch(
          url.startsWith("http") ? url : `${API_BASE_URL}${url}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );

        if (revoked || requestId !== requestIdRef.current) return;

        if (response.status === 409) {
          setStatusKind("preparing");
          setError("Recording is being prepared.");
          setBlobUrl("");
          return;
        }

        if (response.status === 404) {
          setStatusKind("unavailable");
          setError("Recording is not available yet.");
          setBlobUrl("");
          return;
        }

        if (response.status >= 500) {
          setStatusKind("failed");
          setError("Recording failed to load from the media service.");
          setBlobUrl("");
          return;
        }

        if (!response.ok) {
          setStatusKind("failed");
          setError("Recording could not be loaded.");
          setBlobUrl("");
          return;
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { message?: string };
          setStatusKind("preparing");
          setError(payload.message || "Recording is being prepared.");
          setBlobUrl("");
          return;
        }

        const blob = await response.blob();
        currentUrl = URL.createObjectURL(blob);

        if (!revoked && requestId === requestIdRef.current) {
          setBlobUrl(currentUrl);
          setError("");
          setStatusKind(null);
        }
      } catch (err) {
        if (!revoked && requestId === requestIdRef.current) {
          setStatusKind("failed");
          setError(
            err instanceof Error ? err.message : "Failed to load recording",
          );
          setBlobUrl("");
        }
      } finally {
        if (!revoked && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }

    void loadAudio();

    return () => {
      revoked = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div
        className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-white/40"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="animate-spin" size={16} aria-hidden />
        Loading recording...
      </div>
    );
  }

  if (error) {
    const tone =
      statusKind === "preparing"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-100/80"
        : statusKind === "failed"
          ? "border-red-500/20 bg-red-500/10 text-red-100/80"
          : "border-white/10 bg-black/25 text-white/45";

    return (
      <div className={`rounded-2xl border px-4 py-3 text-sm ${tone}`} role="status">
        {error}
      </div>
    );
  }

  if (!blobUrl) return null;

  return <audio controls src={blobUrl} className="w-full" aria-label={label} />;
}
