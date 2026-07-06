const DEPLOYED_API_BASE_URL = "https://smart-ir-remote-hub.onrender.com";

function resolveApiBaseUrl() {
  const explicitBase = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalhost) return DEPLOYED_API_BASE_URL;
  }

  return "http://localhost:3000";
}

const API_BASE_URL = resolveApiBaseUrl();

export async function apiCall(path, { method = "GET", token, body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw || "Request failed." };
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
} 
