function resolveApiBaseUrl() {
  const explicitBase = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const apiProtocol = protocol === "https:" ? "https:" : "http:";
    const inferredBase = `${apiProtocol}//${hostname}:3000`;

    if (explicitBase) {
      try {
        const parsed = new URL(explicitBase);
        const explicitHost = parsed.hostname.toLowerCase();
        const pageHost = hostname.toLowerCase();
        const pageIsLocalhost = pageHost === "localhost" || pageHost === "127.0.0.1";
        const apiIsLocalhost = explicitHost === "localhost" || explicitHost === "127.0.0.1";

        // When the app is opened from another device, a localhost API target would point
        // back to that device rather than this PC, so prefer the current host instead.
        if (apiIsLocalhost && !pageIsLocalhost) {
          return inferredBase;
        }
      } catch {
        return explicitBase.replace(/\/+$/, "");
      }

      return explicitBase.replace(/\/+$/, "");
    }

    return inferredBase;
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
