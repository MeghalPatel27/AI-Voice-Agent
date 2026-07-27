export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export class ApiError extends Error {
  status: number;
  aborted: boolean;

  constructor(message: string, status: number, aborted = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.aborted = aborted;
  }
}

type SessionInvalidationReason = "unauthorized";

type SessionInvalidationListener = (reason: SessionInvalidationReason) => void;

let sessionInvalidationListener: SessionInvalidationListener | null = null;
let sessionInvalidationDispatched = false;

export function registerSessionInvalidationListener(
  listener: SessionInvalidationListener | null,
) {
  sessionInvalidationListener = listener;
  sessionInvalidationDispatched = false;
}

function notifySessionInvalidation(reason: SessionInvalidationReason) {
  if (sessionInvalidationDispatched) return;
  sessionInvalidationDispatched = true;
  sessionInvalidationListener?.(reason);
}

function getErrorMessage(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return undefined;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem("airadesk_token");

  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ApiError("Request aborted", 0, true);
    }
    throw error;
  }

  if (options.signal?.aborted) {
    throw new ApiError("Request aborted", 0, true);
  }

  let data: unknown = null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      notifySessionInvalidation("unauthorized");
    }
    throw new ApiError(
      getErrorMessage(data) || "Request failed",
      response.status,
    );
  }

  return data as T;
}
