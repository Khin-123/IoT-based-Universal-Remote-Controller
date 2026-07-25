import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { admin, db } from "./firebaseAdmin.js";
import { verifyFirebaseToken } from "./authMiddleware.js";


const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(moduleDir, "..", ".env") });
const app = express();

function parseAllowedOrigins() {
  const configured = String(process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = ["http://localhost:5173"];
  const all = [...defaults, ...configured];
  return [...new Set(all)];
}

const allowedOrigins = parseAllowedOrigins();
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients and same-origin calls.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 3000);

function inferDeviceType(deviceName) {
  const upper = String(deviceName || "").toUpperCase();
  if (upper.startsWith("TV")) return "TV";
  if (upper.startsWith("AC")) return "AC";
  if (upper.startsWith("FAN")) return "FAN";
  if (upper.startsWith("PROJECTOR")) return "PROJECTOR";
  if (upper.startsWith("LIGHT")) return "LIGHT";
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
  const cleaned = name.trim();
  if (!cleaned) {
    return `${label} is required.`;
  }
  // Allow spaces and most symbols, but block "." and "/" to keep Firestore update paths safe.
  if (/[./]/.test(cleaned) || /[\n\r\t]/.test(cleaned)) {
    return `${label} cannot contain "." or "/" or newlines.`;
  }
  return null;
}

function makeHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeEspId(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  // allow hex + separators; store as uppercase hex without separators.
  const hex = cleaned.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length < 8) return "";
  if (!/^[0-9A-F]+$/.test(hex)) return "";
  return hex;
}

function newRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const espSockets = new Map(); // espId -> WebSocket
const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout, startedAt, timingLabel }

function sendToEsp(espId, payload) {
  const ws = espSockets.get(espId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw makeHttpError(409, `ESP ${espId} is not connected to the server.`);
  }
  ws.send(JSON.stringify(payload));
}

function sendToEspAwait(espId, payload, { timeoutMs = 20000 } = {}) {
  const requestId = payload.requestId || newRequestId();
  const withId = { ...payload, requestId };
  const timingLabel = payload.type === "learn" ? "Learning" : payload.type === "send" ? "Send" : "Operation";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(makeHttpError(504, "ESP response timed out."));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout, startedAt: Date.now(), timingLabel });
    try {
      sendToEsp(espId, withId);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

app.get("/health", (_, res) => {
  res.json({ success: true, message: "Backend is running." });
});

function deviceDocRef(uid, remoteId, deviceName) {
  return db.collection("users").doc(uid).collection("remotes").doc(remoteId).collection("devices").doc(deviceName);
}

function remoteDocRef(uid, remoteId) {
  return db.collection("users").doc(uid).collection("remotes").doc(remoteId);
}

async function assertRemoteOwnership(uid, remoteId) {
  const snap = await remoteDocRef(uid, remoteId).get();
  if (!snap.exists) throw makeHttpError(404, "Remote not found for this account.");
  return snap;
}

app.get("/api/remotes", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snaps = await db.collection("users").doc(uid).collection("remotes").get();
    const remotes = snaps.docs
      .map((d) => ({
        remoteId: d.id,
        name: d.data()?.name || d.id,
        espId: d.data()?.espId || d.id,
        createdAt: d.data()?.createdAt || null,
        lastSelectedAt: d.data()?.lastSelectedAt || null,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    res.json({ success: true, remotes });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: "Failed to fetch remotes.", error: error.message });
  }
});

app.post("/api/remotes", verifyFirebaseToken, async (req, res) => {
  const { espId, name } = req.body || {};
  const esp = normalizeEspId(espId);
  const nameError = validateName(name, "name");
  if (!esp) {
    res.status(400).json({ success: false, message: "Invalid espId." });
    return;
  }
  if (nameError) {
    res.status(400).json({ success: false, message: nameError });
    return;
  }

  try {
    const uid = req.user.uid;
    // Allow adding a remote even if it's not currently online; user can connect later.
    await remoteDocRef(uid, esp).set(
      {
        espId: esp,
        name: String(name).trim(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ success: true, message: "Remote added.", remoteId: esp });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to add remote.", error: error.message });
  }
});

app.delete("/api/remotes", verifyFirebaseToken, async (req, res) => {
  const { remoteId } = req.body || {};
  const remote = normalizeEspId(remoteId);
  if (!remote) {
    res.status(400).json({ success: false, message: "Invalid remoteId." });
    return;
  }

  try {
    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);

    // Delete remote doc only (leave devices cleanup as future enhancement).
    await remoteDocRef(uid, remote).delete();
    res.json({ success: true, message: "Remote removed.", remoteId: remote });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: "Failed to remove remote.", error: error.message });
  }
});

app.post("/api/learn", verifyFirebaseToken, async (req, res) => {
  const { remoteId, deviceName, commandName, deviceType, timeoutMs } = req.body || {};

  const remote = normalizeEspId(remoteId);
  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");
  if (!remote) {
    res.status(400).json({ success: false, message: "remoteId is required." });
    return;
  }

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);

    const payload = await sendToEspAwait(remote, {
      type: "learn",
      timeoutMs: Number(timeoutMs || 15000),
    }, { timeoutMs: Math.min(Math.max(Number(timeoutMs || 15000) + 5000, 8000), 60000) });

    if (!payload || payload.success === false) {
      res.status(502).json({ success: false, message: payload?.message || "ESP learn failed.", esp: payload });
      return;
    }

    const irData = normalizeIrData(payload);
    const deviceRef = deviceDocRef(uid, remote, deviceName.trim());
    const snap = await deviceRef.get();
    const existingType = snap.data()?.type;
    const type = normalizeDeviceType(deviceType) || normalizeDeviceType(existingType) || inferDeviceType(deviceName);

    await deviceRef.set(
      {
        deviceName: deviceName.trim(),
        type,
        commands: {
          [commandName.trim()]: irData,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      success: true,
      message: "IR command learned and saved to Firestore.",
      remoteId: remote,
      deviceName,
      commandName,
      irData,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Learn failed.", error: error.message });
  }
});

app.delete("/api/command", verifyFirebaseToken, async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const remoteId = body.remoteId || query.remoteId;
  const deviceName = body.deviceName || query.deviceName;
  const commandName = body.commandName || query.commandName;

  const remote = normalizeEspId(remoteId);
  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");
  if (!remote) {
    res.status(400).json({ success: false, message: "remoteId is required." });
    return;
  }

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);
    const deviceRef = deviceDocRef(uid, remote, deviceName.trim());
    let commandsLeft = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(deviceRef);
      if (!snap.exists) {
        throw makeHttpError(404, `Device ${deviceName} not found.`);
      }

      const commands = snap.data()?.commands || {};
      if (!Object.prototype.hasOwnProperty.call(commands, commandName)) {
        throw makeHttpError(404, `Command ${commandName} not found for ${deviceName}.`);
      }

      commandsLeft = Math.max(0, Object.keys(commands).length - 1);
      tx.update(deviceRef, {
        [`commands.${commandName}`]: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({
      success: true,
      message: commandsLeft === 0 ? "Command deleted. Device now has no commands." : "Command deleted.",
      remoteId: remote,
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
  const { remoteId, oldDeviceName, newDeviceName } = req.body || {};

  const remote = normalizeEspId(remoteId);
  const oldError = validateName(oldDeviceName, "oldDeviceName");
  const newError = validateName(newDeviceName, "newDeviceName");
  if (!remote) {
    res.status(400).json({ success: false, message: "remoteId is required." });
    return;
  }

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
    await assertRemoteOwnership(uid, remote);
    const oldRef = deviceDocRef(uid, remote, oldDeviceName.trim());
    const newRef = deviceDocRef(uid, remote, newDeviceName.trim());

    await db.runTransaction(async (tx) => {
      const oldSnap = await tx.get(oldRef);
      if (!oldSnap.exists) {
        throw makeHttpError(404, `Device ${oldDeviceName} not found.`);
      }

      const newSnap = await tx.get(newRef);
      if (newSnap.exists) {
        throw makeHttpError(409, `Device ${newDeviceName} already exists.`);
      }

      const data = oldSnap.data() || {};
      tx.set(newRef, { ...data, deviceName: newDeviceName.trim(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.delete(oldRef);
    });

    res.json({
      success: true,
      message: "Device renamed successfully.",
      remoteId: remote,
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

app.delete("/api/device", verifyFirebaseToken, async (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const remoteId = body.remoteId || query.remoteId;
  const deviceName = body.deviceName || query.deviceName;

  const remote = normalizeEspId(remoteId);
  const deviceError = validateName(deviceName, "deviceName");
  if (!remote) {
    res.status(400).json({ success: false, message: "remoteId is required." });
    return;
  }
  if (deviceError) {
    res.status(400).json({ success: false, message: deviceError });
    return;
  }

  try {
    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);
    const deviceRef = deviceDocRef(uid, remote, deviceName.trim());

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(deviceRef);
      if (!snap.exists) {
        throw makeHttpError(404, `Device ${deviceName} not found.`);
      }

      tx.delete(deviceRef);
    });

    res.json({
      success: true,
      message: "Device deleted successfully.",
      remoteId: remote,
      deviceName,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to delete device.",
      error: error.status ? undefined : error.message,
    });
  }
});
app.post("/api/send", verifyFirebaseToken, async (req, res) => {
  const { remoteId, deviceName, commandName } = req.body || {};

  const remote = normalizeEspId(remoteId);
  const deviceError = validateName(deviceName, "deviceName");
  const commandError = validateName(commandName, "commandName");
  if (!remote) {
    res.status(400).json({ success: false, message: "remoteId is required." });
    return;
  }

  if (deviceError || commandError) {
    res.status(400).json({ success: false, message: deviceError || commandError });
    return;
  }

  try {
    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);
    const deviceRef = deviceDocRef(uid, remote, deviceName.trim());
    const snap = await deviceRef.get();
    if (!snap.exists) {
      res.status(404).json({ success: false, message: `Device ${deviceName} not found.` });
      return;
    }

    const commandData = snap.data()?.commands?.[commandName];
    if (!commandData) {
      res.status(404).json({ success: false, message: `Command ${commandName} not found for ${deviceName}.` });
      return;
    }

    const irData = normalizeIrData(commandData);
    const payload = await sendToEspAwait(remote, { type: "send", irData }, { timeoutMs: 15000 });
    if (!payload || payload.success === false) {
      res.status(502).json({ success: false, message: payload?.message || "ESP send failed.", esp: payload });
      return;
    }

    res.json({
      success: true,
      message: "IR command sent via ESP32.",
      remoteId: remote,
      deviceName,
      commandName,
      irData,
      esp32: payload,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Send failed.", error: error.message });
  }
});

app.get("/api/devices", verifyFirebaseToken, async (req, res) => {
  try {
    const remoteId = req.query.remoteId;
    const remote = normalizeEspId(remoteId);
    if (!remote) {
      res.status(400).json({ success: false, message: "remoteId is required." });
      return;
    }

    const uid = req.user.uid;
    await assertRemoteOwnership(uid, remote);
    const snaps = await db.collection("users").doc(uid).collection("remotes").doc(remote).collection("devices").get();
    const devices = snaps.docs.map((d) => ({
      deviceName: d.id,
      type: d.data()?.type || "UNKNOWN",
      commands: d.data()?.commands || {},
    }));

    res.json({ success: true, remoteId: remote, devices });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch devices.", error: error.message });
  }
});

const httpServer = http.createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
wss.on("connection", (ws) => {
  let boundEspId = "";

  ws.on("message", (data) => {
    let payload = null;
    try {
      payload = JSON.parse(String(data || ""));
    } catch {
      return;
    }

    const type = String(payload?.type || "");
    if (type === "hello") {
      const espId = normalizeEspId(payload.espId);
      if (!espId) {
        ws.send(JSON.stringify({ success: false, type: "error", message: "Invalid espId." }));
        return;
      }
      boundEspId = espId;
      espSockets.set(espId, ws);
      ws.send(JSON.stringify({ success: true, type: "hello_ack", espId }));
      return;
    }

    const requestId = payload?.requestId ? String(payload.requestId) : "";
    if (requestId && pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      if (payload?.type === "learn_started" || payload?.type === "send_started") {
        return;
      }

      clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);

      if (payload?.type === "learn_result" || payload?.type === "send_result") {
        const elapsedMs = Date.now() - pending.startedAt;
        console.log(`[TIMING] Total ${pending.timingLabel} Time: ${elapsedMs} ms`);
      }

      pending.resolve(payload);
      return;
    }
  });

  ws.on("close", () => {
    if (boundEspId && espSockets.get(boundEspId) === ws) {
      espSockets.delete(boundEspId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://<host>:${PORT}/ws`);
}); 



