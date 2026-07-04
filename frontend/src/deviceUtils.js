// Allow spaces and most symbols, but block "." and "/" to keep Firestore update paths safe.
const NAME_PATTERN = /^[^./\n\r\t]+$/;

export const DEVICE_TYPE_OPTIONS = ["TV", "AC", "FAN", "PROJECTOR", "LIGHT"];

export const DEFAULT_CONTROL_VALUES = {
  acTemp: 24,
  acMode: "cooling",
  tvVolume: 5,
  tvChannel: 1,
  fanSpeed: 1,
};

export function isValidName(value) {
  return NAME_PATTERN.test(String(value || "").trim());
}

export function inferDeviceType(deviceName) {
  const upper = String(deviceName || "").toUpperCase();
  if (upper.startsWith("TV")) return "TV";
  if (upper.startsWith("AC")) return "AC";
  if (upper.startsWith("FAN")) return "FAN";
  if (upper.startsWith("PROJECTOR")) return "PROJECTOR";
  if (upper.startsWith("LIGHT")) return "LIGHT";
  return "UNKNOWN";
}

export function normalizeDeviceType(type, deviceName) {
  const normalized = String(type || "").trim().toUpperCase();
  if (DEVICE_TYPE_OPTIONS.includes(normalized)) return normalized;
  return inferDeviceType(deviceName);
}

export function labelForMode(viewMode) {
  if (viewMode === "add") return "Learn";
  if (viewMode === "edit") return "Edit";
  if (viewMode === "send") return "Send";
  return "Idle";
}

export function suggestNextDeviceName(type, list) {
  const prefix = String(type || "DEVICE").toUpperCase();
  const candidates = list
    .map((device) => device.deviceName)
    .filter((name) => name.toUpperCase().startsWith(prefix));

  let maxSuffix = 0;
  for (const name of candidates) {
    const suffix = Number(name.slice(prefix.length));
    if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix;
  }

  return `${prefix}${maxSuffix + 1}`;
}
