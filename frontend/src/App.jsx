import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./App.css";

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
// Allow spaces and most symbols, but block "." and "/" to keep Firestore update paths safe.
const NAME_PATTERN = /^[^./\n\r\t]+$/;
const DEVICE_TYPE_OPTIONS = ["TV", "AC", "FAN", "PROJECTOR"];
const DEFAULT_CONTROL_VALUES = {
  acTemp: 24,
  acMode: "cooling",
  tvVolume: 5,
  tvChannel: 1,
  fanSpeed: 1,
};

async function apiCall(path, { method = "GET", token, body } = {}) {
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

async function queuePendingCommand(uid, deviceName, commandName) {
  await setDoc(
    doc(db, "commands", uid),
    {
      pending: {
        device: deviceName,
        command: commandName,
        timestamp: Date.now(),
      },
    },
    { merge: true }
  );
}

function isValidName(value) {
  return NAME_PATTERN.test(String(value || "").trim());
}

function inferDeviceType(deviceName) {
  const upper = String(deviceName || "").toUpperCase();
  if (upper.startsWith("TV")) return "TV";
  if (upper.startsWith("AC")) return "AC";
  if (upper.startsWith("FAN")) return "FAN";
  if (upper.startsWith("PROJECTOR")) return "PROJECTOR";
  return "UNKNOWN";
}

function normalizeDeviceType(type, deviceName) {
  const normalized = String(type || "").trim().toUpperCase();
  if (DEVICE_TYPE_OPTIONS.includes(normalized)) return normalized;
  return inferDeviceType(deviceName);
}

function labelForMode(viewMode) {
  if (viewMode === "add") return "Learn";
  if (viewMode === "edit") return "Edit";
  if (viewMode === "send") return "Send";
  return "Idle";
}

function AuthCard({
  busy,
  isRegister,
  email,
  password,
  status,
  onToggle,
  onSubmit,
  onGoogle,
  setEmail,
  setPassword,
}) {
  return (
    <section className="auth-wrap">
      <section className="auth-card">
        <h1>Smart IR Remote Hub</h1>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          <button type="submit" disabled={busy || !email.trim() || !password.trim()}>
            {isRegister ? "Register" : "Login"}
          </button>
        </form>

        <div className="auth-buttons">
          <button className="ghost" onClick={onGoogle} disabled={busy}>Continue with Google</button>
          <button className="link" onClick={onToggle} disabled={busy}>
            {isRegister ? "Already have an account? Login" : "Need an account? Register"}
          </button>
        </div>

        <p className="terminal-line">{busy ? "Working..." : status}</p>
      </section>
    </section>
  );
}

function VerifyEmailCard({ busy, status, email, onRefresh, onResend, onLogout }) {
  return (
    <section className="auth-wrap">
      <section className="auth-card">
        <h1>Verify Your Email</h1>
        <p className="muted">
          {email
            ? `A verification link was sent to ${email}.`
            : "A verification email has been sent to your inbox."}
        </p>
        <p className="muted">Open the link in your email, then return here and refresh your status.</p>

        <div className="auth-buttons">
          <button onClick={onRefresh} disabled={busy}>I've verified my email</button>
          <button className="ghost" onClick={onResend} disabled={busy}>Resend verification email</button>
          <button className="danger" onClick={onLogout} disabled={busy}>Logout</button>
        </div>

        <p className="terminal-line">{busy ? "Working..." : status}</p>
      </section>
    </section>
  );
}

function RemotePicker({
  remotes,
  selectedRemoteId,
  espId,
  remoteName,
  busy,
  status,
  onSelect,
  onAdd,
  onRemove,
  onBackToAuth,
  setEspId,
  setRemoteName,
}) {
  return (
    <section className="auth-wrap">
      <section className="auth-card">
        <h1>Select Remote</h1>

        {remotes.length === 0 ? (
          <p className="muted">No remotes added yet.</p>
        ) : (
          <div className="device-list">
            {remotes.map((r) => (
              <article
                key={r.remoteId}
                className={`device-item ${selectedRemoteId === r.remoteId ? "active" : ""}`}
                onClick={() => onSelect(r.remoteId)}
              >
                <div className="device-item-top">
                  <strong>{r.name || r.remoteId}</strong>
                  <span className="badge">{r.remoteId}</span>
                </div>
                <div className="device-item-actions">
                  <button
                    className="danger tiny"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(r.remoteId);
                    }}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="divider" />

        <h3>Add Remote (ESP ID)</h3>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <label>
            ESP ID (from Serial Monitor)
            <input value={espId} onChange={(e) => setEspId(e.target.value)} placeholder="e.g. 24A160FF12AB" required />
          </label>

          <label>
            Remote name
            <input value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="Living room" required />
          </label>

          <button type="submit" disabled={busy || !espId.trim() || !remoteName.trim()}>
            Add Remote
          </button>
        </form>

        <p className="terminal-line">{busy ? "Working..." : status}</p>

        <div className="auth-buttons">
          <button className="ghost" onClick={onBackToAuth} disabled={busy}>
            Back to Login / Signup
          </button>
        </div>
      </section>
    </section>
  );
}

function TerminalPanel({ logs, status }) {
  return (
    <section className="terminal-card">
      <header className="terminal-head">Terminal</header>
      <div className="terminal-body">
        <div className="terminal-line">{status}</div>
        {logs.length === 0
          ? <div className="terminal-line">No events</div>
          : logs.map((entry) => <div key={entry.id} className="terminal-line">{entry.text}</div>)}
      </div>
    </section>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready.");

  const [remotes, setRemotes] = useState([]);
  const [activeRemoteId, setActiveRemoteId] = useState("");
  const [espIdDraft, setEspIdDraft] = useState("");
  const [remoteNameDraft, setRemoteNameDraft] = useState("");

  const [viewMode, setViewMode] = useState("idle");
  const [draftType, setDraftType] = useState("TV");
  const [draftDeviceName, setDraftDeviceName] = useState("TV1");
  const [editDeviceName, setEditDeviceName] = useState("");
  const [activeDeviceName, setActiveDeviceName] = useState("");
  const [pendingLearnCount, setPendingLearnCount] = useState(0);

  const [controlValues, setControlValues] = useState(DEFAULT_CONTROL_VALUES);
  const [logs, setLogs] = useState([]);

  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => a.deviceName.localeCompare(b.deviceName)),
    [devices]
  );

  const activeDevice = useMemo(
    () => sortedDevices.find((d) => d.deviceName === activeDeviceName) || null,
    [sortedDevices, activeDeviceName]
  );

  const activeType = useMemo(() => {
    if (viewMode === "add") return draftType;
    if (!activeDevice) return "UNKNOWN";
    return normalizeDeviceType(activeDevice.type, activeDevice.deviceName);
  }, [viewMode, draftType, activeDevice]);

  const canSaveNew = viewMode === "add" && isValidName(draftDeviceName) && pendingLearnCount > 0;
  // In edit mode, allow "Save Changes" even if nothing was learned/changed (acts like "Done").
  const canSaveEdit = viewMode === "edit" && !!activeDevice;

  function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      text: `[${timestamp}] ${message}`,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 80));
  }

  async function getToken() {
    return user.getIdToken();
  }

  async function loadRemotes(token, successMessage = "Remotes loaded.") {
    const payload = await apiCall("/api/remotes", { method: "GET", token });
    setRemotes(payload.remotes || []);
    setStatus(successMessage);
  }

  async function loadDevices(token, remoteId, successMessage = "Devices loaded.") {
    const payload = await apiCall(`/api/devices?remoteId=${encodeURIComponent(remoteId)}`, { method: "GET", token });
    const normalized = (payload.devices || []).map((device) => ({
      ...device,
      type: normalizeDeviceType(device.type, device.deviceName),
      commands: device.commands || {},
    }));

    setDevices(normalized);
    setStatus(successMessage);
  }

  function isEmailNotVerifiedError(error) {
    return String(error?.message || "").toLowerCase().includes("email not verified");
  }

  function forceVerificationGate(
    message = "Email not verified. Please verify your email before accessing the system."
  ) {
    resetWorkspaceState();
    setIsEmailVerified(false);
    setStatus(message);
    addLog(message);
  }

  async function runAction(label, fn) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      if (isEmailNotVerifiedError(error)) {
        forceVerificationGate();
        return;
      }
      const msg = `${label} failed: ${error.message}`;
      setStatus(msg);
      addLog(msg);
    } finally {
      setBusy(false);
    }
  }

  function resetControlValues() {
    setControlValues(DEFAULT_CONTROL_VALUES);
  }

  function resetWorkspaceState() {
    setDevices([]);
    setRemotes([]);
    setActiveRemoteId("");
    setViewMode("idle");
    setActiveDeviceName("");
    setPendingLearnCount(0);
    setLogs([]);
    resetControlValues();
  }

  function suggestNextDeviceName(type, list) {
    const prefix = String(type || "DEVICE").toUpperCase();
    const candidates = list
      .map((d) => d.deviceName)
      .filter((name) => name.toUpperCase().startsWith(prefix));

    let maxSuffix = 0;
    for (const name of candidates) {
      const suffix = Number(name.slice(prefix.length));
      if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix;
    }

    return `${prefix}${maxSuffix + 1}`;
  }

  function hasCommand(device, commandName) {
    if (!device) return false;
    return Object.prototype.hasOwnProperty.call(device.commands || {}, commandName);
  }

  async function triggerLearn(commandName) {
    if (!user || !activeRemoteId) return;

    const deviceName = viewMode === "add" ? draftDeviceName.trim() : activeDeviceName;
    if (!isValidName(deviceName)) {
      const msg = "Set a valid device name.";
      setStatus(msg);
      addLog(msg);
      return;
    }

    await runAction("Learn", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/learn", {
        method: "POST",
        token,
        body: { remoteId: activeRemoteId, deviceName, commandName, deviceType: activeType },
      });

      setPendingLearnCount((n) => n + 1);
      addLog(`IR learned: ${deviceName}/${commandName}`);
      await loadDevices(token, activeRemoteId, payload.message || "IR learned.");
    });
  }

  async function triggerSend(commandName) {
    if (!user || !activeRemoteId || !activeDevice) return;

    if (!hasCommand(activeDevice, commandName)) {
      const msg = `Missing command: ${activeDevice.deviceName}/${commandName}`;
      setStatus(msg);
      addLog(msg);
      return;
    }

    await runAction("Send", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/send", {
        method: "POST",
        token,
        body: { remoteId: activeRemoteId, deviceName: activeDevice.deviceName, commandName },
      });

      const msg = payload.message || `Command sent: ${activeDevice.deviceName}/${commandName}`;
      setStatus(msg);
      addLog(`Command sent: ${activeDevice.deviceName}/${commandName}`);
    });
  }

  async function executeCommand(commandName) {
    if (viewMode === "send") return triggerSend(commandName);
    if (viewMode === "add" || viewMode === "edit") return triggerLearn(commandName);
  }

  function beginAddDevice(type) {
    const nextType = String(type || "TV").toUpperCase();
    const suggested = suggestNextDeviceName(nextType, sortedDevices);

    setViewMode("add");
    setDraftType(nextType);
    setDraftDeviceName(suggested);
    setActiveDeviceName("");
    setPendingLearnCount(0);
    resetControlValues();

    const msg = `${nextType} learn mode.`;
    setStatus(msg);
    addLog(msg);
  }

  function openDeviceSendMode(deviceName) {
    setActiveDeviceName(deviceName);
    setViewMode("send");
    setPendingLearnCount(0);
    resetControlValues();

    const msg = `Send mode: ${deviceName}`;
    setStatus(msg);
    addLog(msg);
  }

  function openDeviceEditMode(deviceName) {
    setActiveDeviceName(deviceName);
    setViewMode("edit");
    setPendingLearnCount(0);
    setEditDeviceName(deviceName);
    resetControlValues();

    const msg = `Edit mode: ${deviceName}`;
    setStatus(msg);
    addLog(msg);
  }

  async function handleSaveNewDevice() {
    if (!user || !canSaveNew) return;

    await runAction("Save device", async () => {
      const token = await getToken();
      await loadDevices(token, activeRemoteId, "Device saved.");
      setViewMode("send");
      setActiveDeviceName(draftDeviceName.trim());
      setPendingLearnCount(0);
      addLog(`Device saved: ${draftDeviceName.trim()}`);
    });
  }

  async function handleSaveEdit() {
    if (!user || !activeDevice) return;

    await runAction("Save changes", async () => {
      const token = await getToken();
      const nextName = editDeviceName.trim();

      if (nextName && nextName !== activeDevice.deviceName) {
        if (!isValidName(nextName)) {
          throw new Error("Invalid device name.");
        }

        await apiCall("/api/device/rename", {
          method: "PATCH",
          token,
          body: { remoteId: activeRemoteId, oldDeviceName: activeDevice.deviceName, newDeviceName: nextName },
        });

        setActiveDeviceName(nextName);
        addLog(`Renamed: ${activeDevice.deviceName} -> ${nextName}`);
      }

      await loadDevices(token, activeRemoteId, "Changes saved.");
      setViewMode("send");
      setPendingLearnCount(0);
      addLog(`Device updated: ${nextName || activeDevice.deviceName}`);
    });
  }

  async function handleRenameDevice(deviceName) {
    if (!user) return;

    const newDeviceName = window.prompt("Rename device", deviceName);
    if (!newDeviceName) return;

    const cleaned = newDeviceName.trim();
    if (!isValidName(cleaned)) {
      const msg = "Invalid name.";
      setStatus(msg);
      addLog(msg);
      return;
    }

    await runAction("Rename", async () => {
      const token = await getToken();
      await apiCall("/api/device/rename", {
        method: "PATCH",
        token,
        body: { remoteId: activeRemoteId, oldDeviceName: deviceName, newDeviceName: cleaned },
      });

      await loadDevices(token, activeRemoteId, "Device renamed.");
      if (activeDeviceName === deviceName) setActiveDeviceName(cleaned);
      addLog(`Renamed: ${deviceName} -> ${cleaned}`);
    });
  }

  async function handleDeleteDevice(deviceName) {
    if (!user) return;

    const confirmed = window.confirm(`Delete ${deviceName}?`);
    if (!confirmed) return;

    await runAction("Delete device", async () => {
      const token = await getToken();
      await apiCall("/api/device", { method: "DELETE", token, body: { remoteId: activeRemoteId, deviceName } });

      await loadDevices(token, activeRemoteId, "Device deleted.");
      if (activeDeviceName === deviceName) {
        setViewMode("idle");
        setActiveDeviceName("");
      }
      addLog(`Deleted: ${deviceName}`);
    });
  }

  const handleEmailAuth = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) return;

    await runAction(isRegister ? "Register" : "Login", async () => {
      if (isRegister) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(credential.user);
        setIsEmailVerified(false);
        setStatus("Registration successful. Check your inbox and verify your email to continue.");
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!credential.user.emailVerified) {
          setIsEmailVerified(false);
          setStatus("Email not verified. Verify your email, then click \"I've verified my email\".");
          return;
        }
        setIsEmailVerified(true);
        setStatus("Login successful.");
      }
    });
  };

  const handleGoogleLogin = async () => {
    await runAction("Google login", async () => {
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      if (!credential.user.emailVerified) {
        setIsEmailVerified(false);
        setStatus("Google account email is not verified. Verify your email to continue.");
        return;
      }
      setIsEmailVerified(true);
      setStatus("Google login successful.");
    });
  };

  const handleLogout = async () => {
    await runAction("Logout", async () => {
      await signOut(auth);
      setIsEmailVerified(false);
      resetWorkspaceState();
      setStatus("Logged out.");
    });
  };

  const handleRefresh = async () => {
    if (!user) return;

    await runAction("Refresh", async () => {
      const token = await getToken();
      if (!activeRemoteId) {
        await loadRemotes(token, "Remote list refreshed.");
        addLog("Remote list refreshed.");
        return;
      }
      await loadDevices(token, activeRemoteId, "Device list refreshed.");
      addLog("Device list refreshed.");
    });
  };

  const handleRefreshVerification = async () => {
    if (!auth.currentUser) return;

    await runAction("Check verification", async () => {
      await auth.currentUser.reload();
      const refreshedUser = auth.currentUser;
      if (!refreshedUser) {
        throw new Error("Session expired. Please log in again.");
      }
      const verified = Boolean(refreshedUser?.emailVerified);
      if (verified) {
        // Force-refresh token so backend sees updated email_verified claim immediately.
        await refreshedUser.getIdToken(true);
      }
      setUser(refreshedUser);
      setIsEmailVerified(verified);

      if (verified) {
        setStatus("Email verified. Access granted.");
        addLog("Email verification completed.");
        return;
      }

      setStatus("Email is still unverified. Open the email link, then try again.");
    });
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;

    await runAction("Resend verification", async () => {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        await auth.currentUser.getIdToken(true);
        setUser(auth.currentUser);
        setIsEmailVerified(true);
        setStatus("Your email is already verified. Access granted.");
        return;
      }

      await sendEmailVerification(auth.currentUser);
      setStatus("Verification email sent. Please check your inbox (and spam folder).");
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsEmailVerified(Boolean(nextUser?.emailVerified));
      setAuthReady(true);
      if (!nextUser || !nextUser.emailVerified) {
        resetWorkspaceState();
      }
      if (nextUser && !nextUser.emailVerified) {
        setStatus("Please verify your email to access the system.");
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !user.emailVerified || !isEmailVerified) return;

    let cancelled = false;

    (async () => {
      setBusy(true);
      try {
        const token = await user.getIdToken();
        const remotesPayload = await apiCall("/api/remotes", { method: "GET", token });
        if (cancelled) return;

        const list = remotesPayload.remotes || [];
        setRemotes(list);
        setStatus("Loaded remotes.");
        addLog("Session started.");
      } catch (error) {
        if (!cancelled) {
          if (isEmailNotVerifiedError(error)) {
            forceVerificationGate();
            return;
          }
          const msg = `Load failed: ${error.message}`;
          setStatus(msg);
          addLog(msg);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isEmailVerified]);

  async function handleAddRemote() {
    if (!user) return;
    if (!espIdDraft.trim() || !remoteNameDraft.trim()) return;

    await runAction("Add remote", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/remotes", {
        method: "POST",
        token,
        body: { espId: espIdDraft.trim(), name: remoteNameDraft.trim() },
      });
      await loadRemotes(token, payload.message || "Remote added.");
      setEspIdDraft("");
      setRemoteNameDraft("");
      addLog(`Remote added: ${payload.remoteId || espIdDraft.trim()}`);
    });
  }

  async function handleRemoveRemote(remoteId) {
    if (!user) return;
    const confirmed = window.confirm(`Remove remote ${remoteId}?`);
    if (!confirmed) return;

    await runAction("Remove remote", async () => {
      const token = await getToken();
      await apiCall("/api/remotes", { method: "DELETE", token, body: { remoteId } });
      if (activeRemoteId === remoteId) {
        setActiveRemoteId("");
        setDevices([]);
        setViewMode("idle");
        setActiveDeviceName("");
      }
      await loadRemotes(token, "Remote removed.");
      addLog(`Remote removed: ${remoteId}`);
    });
  }

  async function handleSelectRemote(remoteId) {
    if (!user) return;
    const cleaned = String(remoteId || "").trim();
    if (!cleaned) return;

    await runAction("Select remote", async () => {
      const token = await getToken();
      setActiveRemoteId(cleaned);
      setDevices([]);
      setViewMode("idle");
      setActiveDeviceName("");
      setPendingLearnCount(0);
      resetControlValues();
      await loadDevices(token, cleaned, "Remote selected.");
      addLog(`Remote selected: ${cleaned}`);
    });
  }

  async function handleBackToAuth() {
    await runAction("Back to auth", async () => {
      await signOut(auth);
      setIsEmailVerified(false);
      resetWorkspaceState();
      setStatus("Returned to login/signup.");
    });
  }

  const panelTitle = useMemo(() => {
    if (viewMode === "add") return `${draftType} Setup`;
    if (activeDevice) return activeDevice.deviceName;
    return "Device Control";
  }, [viewMode, draftType, activeDevice]);

  if (!authReady) {
    return (
      <main className="page">
        <section className="auth-card">Loading authentication...</section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page">
        <AuthCard
          busy={busy}
          isRegister={isRegister}
          email={email}
          password={password}
          status={status}
          onToggle={() => setIsRegister((v) => !v)}
          onSubmit={handleEmailAuth}
          onGoogle={handleGoogleLogin}
          setEmail={setEmail}
          setPassword={setPassword}
        />
      </main>
    );
  }

  if (!isEmailVerified || !user.emailVerified) {
    return (
      <main className="page">
        <VerifyEmailCard
          busy={busy}
          status={status}
          email={user?.email || ""}
          onRefresh={handleRefreshVerification}
          onResend={handleResendVerification}
          onLogout={handleLogout}
        />
      </main>
    );
  }

  if (!activeRemoteId) {
    return (
      <main className="page">
        <RemotePicker
          remotes={remotes}
          selectedRemoteId={activeRemoteId}
          espId={espIdDraft}
          remoteName={remoteNameDraft}
          busy={busy}
          status={status}
          onSelect={handleSelectRemote}
          onAdd={handleAddRemote}
          onRemove={handleRemoveRemote}
          onBackToAuth={handleBackToAuth}
          setEspId={setEspIdDraft}
          setRemoteName={setRemoteNameDraft}
        />
      </main>
    );
  }

  const controlsDisabled = busy || (viewMode !== "add" && !activeDevice);

  return (
    <main className="page app-page">
      <nav className="top-nav glass-card">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true" />
          <strong>Smart IR Remote Hub</strong>
        </div>
        <div className="nav-actions">
          <button className="ghost" onClick={() => setActiveRemoteId("")} disabled={busy}>Switch Remote</button>
          <button className="danger" onClick={handleLogout} disabled={busy}>Logout</button>
        </div>
      </nav>

      <section className="app-shell">
        <aside className="left-panel glass-card">
          <section className="left-section compact">
            <h3>Add Device</h3>
            <div className="type-grid">
              {DEVICE_TYPE_OPTIONS.map((type) => (
                <button
                  key={type}
                  className={`type-button ${viewMode === "add" && draftType === type ? "active" : ""}`}
                  onClick={() => beginAddDevice(type)}
                  disabled={busy}
                >
                  {type}
                </button>
              ))}
            </div>
          </section>

          <section className="left-section device-list-section">
            <div className="section-head">
              <h3>My Devices</h3>
              <button className="ghost tiny" onClick={handleRefresh} disabled={busy}>Refresh</button>
            </div>

            {sortedDevices.length === 0 ? (
              <p className="muted">No devices.</p>
            ) : (
              <div className="device-list">
                {sortedDevices.map((device) => {
                  const isActive = device.deviceName === activeDeviceName;
                  return (
                    <article
                      key={device.deviceName}
                      className={`device-item ${isActive ? "active" : ""}`}
                      onClick={() => openDeviceSendMode(device.deviceName)}
                    >
                      <div className="device-item-top">
                        <strong>{device.deviceName}</strong>
                        <span className="badge">{normalizeDeviceType(device.type, device.deviceName)}</span>
                      </div>

                      <div className="device-item-actions">
                        <button
                          className="ghost tiny"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeviceEditMode(device.deviceName);
                          }}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          className="danger tiny"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDevice(device.deviceName);
                          }}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </aside>

        <section className="right-panel">
          <section className="control-card glass-card">
            <header className="control-head">
              <h2>{panelTitle}</h2>
              <span className="mode-pill">{labelForMode(viewMode)}</span>
            </header>

            {viewMode === "idle" && (
              <div className="idle-state">
                <p>Select a device</p>
              </div>
            )}

            {viewMode !== "idle" && (
              <div className="controls-area">
                {(viewMode === "add" || viewMode === "edit") && (
                  <div className="control-row setup-row">
                    <span>Device name</span>
                    <input
                      value={viewMode === "add" ? draftDeviceName : editDeviceName}
                      onChange={(e) => (viewMode === "add" ? setDraftDeviceName(e.target.value) : setEditDeviceName(e.target.value))}
                      placeholder={viewMode === "add" ? `${draftType}1` : "Device name"}
                      className="device-name-input"
                    />
                  </div>
                )}

                {activeType === "AC" && (
                  <>
                    <div className="control-row ac-top-row">
                      <div className="ac-power">
                        <div className="control-actions no-wrap">
                          <button onClick={() => executeCommand("power_on")} disabled={controlsDisabled}>On</button>
                          <button className="ghost" onClick={() => executeCommand("power_off")} disabled={controlsDisabled}>Off</button>
                        </div>
                      </div>

                      <div className="ac-mode">
                        <span className="mini-label-acmode">Mode</span>
                        <div className="control-actions mode-actions">
                          <button
                            className={controlValues.acMode === "cooling" ? "active-choice" : ""}
                            onClick={async () => {
                              setControlValues((prev) => ({ ...prev, acMode: "cooling" }));
                              await executeCommand("mode_cooling");
                            }}
                            disabled={controlsDisabled}
                          >
                            Cooling
                          </button>
                          <button
                            className={controlValues.acMode === "fan" ? "active-choice" : ""}
                            onClick={async () => {
                              setControlValues((prev) => ({ ...prev, acMode: "fan" }));
                              await executeCommand("mode_fan");
                            }}
                            disabled={controlsDisabled}
                          >
                            Fan
                          </button>
                          <button
                            className={controlValues.acMode === "heating" ? "active-choice" : ""}
                            onClick={async () => {
                              setControlValues((prev) => ({ ...prev, acMode: "heating" }));
                              await executeCommand("mode_heating");
                            }}
                            disabled={controlsDisabled}
                          >
                            Heating
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="control-row">
                      <div className="ac-temp">
                        <span className="mini-label">Temp ({controlValues.acTemp}°C)</span>
                        <div className="slider-learn-row">
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, acTemp: Math.max(17, prev.acTemp - 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Decrease temperature"
                          >
                            -
                          </button>
                          <input
                            type="range"
                            min={17}
                            max={25}
                            step={1}
                            value={controlValues.acTemp}
                            onChange={(e) => setControlValues((prev) => ({ ...prev, acTemp: Number(e.target.value) }))}
                            disabled={controlsDisabled}
                          />
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, acTemp: Math.min(25, prev.acTemp + 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Increase temperature"
                          >
                            +
                          </button>
                          <button
                            className="tiny-cta"
                            onClick={() => executeCommand(`temp_${controlValues.acTemp}`)}
                            disabled={controlsDisabled}
                          >
                            {viewMode === "send" ? "Send" : "Learn"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeType === "TV" && (
                  <>
                    <div className="control-row inline-row">
                      <div className="control-actions no-wrap">
                        <button onClick={() => executeCommand("power")} disabled={controlsDisabled}>Power</button>
                      </div>
                    </div>

                    <div className="control-row tv-sliders-row">
                      <div className="tv-slider-card">
                        <span className="mini-label">Volume ({controlValues.tvVolume})</span>
                        <div className="slider-learn-row">
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, tvVolume: Math.max(0, prev.tvVolume - 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Decrease volume"
                          >
                            -
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={1}
                            value={controlValues.tvVolume}
                            onChange={(e) => setControlValues((prev) => ({ ...prev, tvVolume: Number(e.target.value) }))}
                            disabled={controlsDisabled}
                          />
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, tvVolume: Math.min(10, prev.tvVolume + 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Increase volume"
                          >
                            +
                          </button>
                          <button
                            className="tiny-cta"
                            onClick={() => executeCommand(`volume_${controlValues.tvVolume}`)}
                            disabled={controlsDisabled}
                          >
                            {viewMode === "send" ? "Send" : "Learn"}
                          </button>
                        </div>
                      </div>

                      <div className="tv-slider-card">
                        <span className="mini-label">Channel ({controlValues.tvChannel})</span>
                        <div className="slider-learn-row">
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, tvChannel: Math.max(1, prev.tvChannel - 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Decrease channel"
                          >
                            -
                          </button>
                          <input
                            type="range"
                            min={1}
                            max={20}
                            step={1}
                            value={controlValues.tvChannel}
                            onChange={(e) => setControlValues((prev) => ({ ...prev, tvChannel: Number(e.target.value) }))}
                            disabled={controlsDisabled}
                          />
                          <button
                            type="button"
                            className="edge-btn ghost"
                            onClick={() => setControlValues((prev) => ({ ...prev, tvChannel: Math.min(20, prev.tvChannel + 1) }))}
                            disabled={controlsDisabled}
                            aria-label="Increase channel"
                          >
                            +
                          </button>
                          <button
                            className="tiny-cta"
                            onClick={() => executeCommand(`channel_${controlValues.tvChannel}`)}
                            disabled={controlsDisabled}
                          >
                            {viewMode === "send" ? "Send" : "Learn"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeType === "FAN" && (
                  <>
                    <div className="control-row inline-row">
                      <div className="control-actions no-wrap">
                        <button onClick={() => executeCommand("power")} disabled={controlsDisabled}>Power</button>
                      </div>
                    </div>

                    <div className="control-row">
                      <span className="mini-label">Speed ({controlValues.fanSpeed})</span>
                      <div className="slider-learn-row">
                        <button
                          type="button"
                          className="edge-btn ghost"
                          onClick={() => setControlValues((prev) => ({ ...prev, fanSpeed: Math.max(1, prev.fanSpeed - 1) }))}
                          disabled={controlsDisabled}
                          aria-label="Decrease speed"
                        >
                          -
                        </button>
                        <input
                          type="range"
                          min={1}
                          max={3}
                          step={1}
                          value={controlValues.fanSpeed}
                          onChange={(e) => setControlValues((prev) => ({ ...prev, fanSpeed: Number(e.target.value) }))}
                          disabled={controlsDisabled}
                        />
                        <button
                          type="button"
                          className="edge-btn ghost"
                          onClick={() => setControlValues((prev) => ({ ...prev, fanSpeed: Math.min(3, prev.fanSpeed + 1) }))}
                          disabled={controlsDisabled}
                          aria-label="Increase speed"
                        >
                          +
                        </button>
                        <button
                          className="tiny-cta"
                          onClick={() => executeCommand(`speed_${controlValues.fanSpeed}`)}
                          disabled={controlsDisabled}
                        >
                          {viewMode === "send" ? "Send" : "Learn"}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {activeType === "PROJECTOR" && (
                  <div className="control-row inline-row">
                    <div className="control-actions no-wrap">
                      <button onClick={() => executeCommand("power")} disabled={controlsDisabled}>Power</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <footer className="control-footer">
              {viewMode === "add" && (
                <button onClick={handleSaveNewDevice} disabled={!canSaveNew || busy}>Save Device</button>
              )}
              {viewMode === "edit" && (
                <button onClick={handleSaveEdit} disabled={!canSaveEdit || busy}>Save Changes</button>
              )}
            </footer>
          </section>

          <TerminalPanel logs={logs} status={status} />
        </section>
      </section>
    </main>
  );
}


