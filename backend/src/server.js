import "dotenv/config";
import express from "express";
import cors from "cors";
import { admin, db } from "./firebaseAdmin.js";
import { verifyFirebaseToken } from "./authMiddleware.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 3000);
const ESP32_BASE_URL = (process.env.ESP32_BASE_URL || "http://192.168.1.100").replace(/\/+$/, "");

function inferDeviceType(deviceName) {
  const upper = String(deviceName || "").toUpperCase();
  if (upper.startsWith("TV")) return "TV";
  if (upper.startsWith("AC")) return "AC";
  if (upper.startsWith("FAN")) return "FAN";
  if (upper.startsWith("PROJECTOR")) return "PROJECTOR";
  return "UNKNOWN";
}

function normalizeDeviceType(value) {
  if (!value || typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "";
  if (!/^[A-Z0-9_-]+$/.test(normalized)) return "";
  return normalized;
}

function normalizeIrData(payload) {
  const protocol = String(payload.protocol || "RAW");
  const value = Number(payload.value || 0);
  const bits = Number(payload.bits || 0);
  const raw = Array.isArray(payload.raw) ? payload.raw.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];

  return { protocol, value, bits, raw };
}

function validateName(name, label) {
  if (!name || typeof name !== "string") {
    return `${label} is required.`;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return `${label} can use only letters, numbers, _ and -.`;
  }
  return null;
}

function makeHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function callEsp32(path, options = {}) {
  const url = `${ESP32_BASE_URL}${path}`;
  const response = await fetch(url, options);
  const text = await response.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { success: response.ok, message: text || "Non-JSON response from ESP32." };
  }

  return { url, response, payload };
}

app.get("/health", (_, res) => {
  res.json({ success: true, message: "Backend is running." });
});

app.post("/api/learn", verifyFirebaseToken, async (req, res) => {
  const { deviceName, commandName, deviceType } = req.body || {};

  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const { url, response, payload } = await callEsp32("/learn");

    if (!response.ok || payload.success === false) {
      res.status(502).json({
        success: false,
        message: payload.message || "ESP32 learn failed.",
        forwardedTo: url,
        esp32: payload,
      });
      return;
    }

    const irData = normalizeIrData(payload);
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const existingType = snap.data()?.devices?.[deviceName]?.type;
    const type = normalizeDeviceType(deviceType) || normalizeDeviceType(existingType) || inferDeviceType(deviceName);

    await userRef.set(
      {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        devices: {
          [deviceName]: {
            type,
            commands: {
              [commandName]: irData,
            },
          },
        },
      },
      { merge: true }
    );

    res.json({
      success: true,
      message: "IR command learned and saved to Firestore.",
      deviceName,
      commandName,
      irData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Learn failed.", error: error.message });
  }
});

app.delete("/api/command", verifyFirebaseToken, async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const deviceName = body.deviceName || query.deviceName;
  const commandName = body.commandName || query.commandName;

  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);
    let commandsLeft = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw makeHttpError(404, "User has no saved devices yet.");
      }

      const devices = snap.data()?.devices || {};
      const device = devices[deviceName];
      if (!device) {
        throw makeHttpError(404, `Device ${deviceName} not found.`);
      }

      const commands = device.commands || {};
      if (!Object.prototype.hasOwnProperty.call(commands, commandName)) {
        throw makeHttpError(404, `Command ${commandName} not found for ${deviceName}.`);
      }

      commandsLeft = Math.max(0, Object.keys(commands).length - 1);
      tx.update(userRef, {
        [`devices.${deviceName}.commands.${commandName}`]: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({
      success: true,
      message: commandsLeft === 0 ? "Command deleted. Device now has no commands." : "Command deleted.",
      deviceName,
      commandName,
      commandsLeft,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to delete command.",
      error: error.status ? undefined : error.message,
    });
  }
});

app.patch("/api/device/rename", verifyFirebaseToken, async (req, res) => {
  const { oldDeviceName, newDeviceName } = req.body || {};

  const oldError = validateName(oldDeviceName, "oldDeviceName");
  const newError = validateName(newDeviceName, "newDeviceName");

  if (oldError || newError) {
    res.status(400).json({ success: false, message: oldError || newError });
    return;
  }

  if (oldDeviceName === newDeviceName) {
    res.json({ success: true, message: "Device name is unchanged.", deviceName: oldDeviceName });
    return;
  }

  try {
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw makeHttpError(404, "User has no saved devices yet.");
      }

      const devices = snap.data()?.devices || {};
      const sourceDevice = devices[oldDeviceName];
      if (!sourceDevice) {
        throw makeHttpError(404, `Device ${oldDeviceName} not found.`);
      }

      if (devices[newDeviceName]) {
        throw makeHttpError(409, `Device ${newDeviceName} already exists.`);
      }

      tx.update(userRef, {
        [`devices.${oldDeviceName}`]: admin.firestore.FieldValue.delete(),
        [`devices.${newDeviceName}`]: sourceDevice,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({
      success: true,
      message: "Device renamed successfully.",
      oldDeviceName,
      newDeviceName,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to rename device.",
      error: error.status ? undefined : error.message,
    });
  }
});

app.post("/api/send", verifyFirebaseToken, async (req, res) => {
  const { deviceName, commandName } = req.body || {};

  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      res.status(404).json({ success: false, message: "User has no saved devices yet." });
      return;
    }

    const userData = snap.data() || {};
    const device = userData.devices?.[deviceName];
    if (!device) {
      res.status(404).json({ success: false, message: `Device ${deviceName} not found.` });
      return;
    }

    const commandData = device.commands?.[commandName];
    if (!commandData) {
      res.status(404).json({ success: false, message: `Command ${commandName} not found for ${deviceName}.` });
      return;
    }

    const irData = normalizeIrData(commandData);

    const { url, response, payload } = await callEsp32("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(irData),
    });

    if (!response.ok || payload.success === false) {
      res.status(502).json({
        success: false,
        message: payload.message || "ESP32 send failed.",
        forwardedTo: url,
        esp32: payload,
      });
      return;
    }

    res.json({
      success: true,
      message: "IR command sent via ESP32.",
      deviceName,
      commandName,
      esp32: payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Send failed.", error: error.message });
  }
});

app.get("/api/devices", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      res.json({ success: true, devices: [] });
      return;
    }

    const data = snap.data() || {};
    const devicesMap = data.devices || {};

    const devices = Object.entries(devicesMap).map(([deviceName, deviceData]) => ({
      deviceName,
      type: deviceData?.type || "UNKNOWN",
      commands: deviceData?.commands || {},
    }));

    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch devices.", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`ESP32 base URL: ${ESP32_BASE_URL}`);
});
