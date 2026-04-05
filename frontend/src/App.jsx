import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";
import "./App.css";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const DEVICE_TYPES = ["TV", "AC", "FAN", "PROJECTOR", "UNKNOWN"];
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

async function apiCall(path, { method = "GET", token, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

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

function isValidName(value) {
  return NAME_PATTERN.test(String(value || "").trim());
}

function AuthCard({
  busy,
  canSubmitAuth,
  email,
  password,
  isRegister,
  message,
  setEmail,
  setPassword,
  setIsRegister,
  handleEmailAuth,
  handleGoogleLogin,
}) {
  return (
    <section className="auth-shell">
      <section className="card auth-card">
        <h1>Smart IR Remote</h1>
        <p className="subtle">Sign in to manage your personal IR command library.</p>

        <form onSubmit={handleEmailAuth} className="form-grid auth-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          <button type="submit" disabled={busy || !canSubmitAuth}>
            {isRegister ? "Register" : "Login"}
          </button>
        </form>

        <div className="auth-actions">
          <button className="secondary" onClick={handleGoogleLogin} disabled={busy}>
            Continue with Google
          </button>

          <button className="link" onClick={() => setIsRegister((s) => !s)} disabled={busy}>
            {isRegister ? "Already have an account? Login" : "Need an account? Register"}
          </button>
        </div>

        <p className="status">{busy ? "Working..." : message}</p>
      </section>
    </section>
  );
}

function CreateDeviceCard({
  newDeviceName,
  setNewDeviceName,
  newDeviceType,
  setNewDeviceType,
  newCommandName,
  setNewCommandName,
  onLearn,
  disabled,
}) {
  return (
    <section className="card section-card">
      <h2>Create Device + Learn First Command</h2>
      <p className="subtle">Use simple names like TV1, AC1, FAN1. Command names can be power, volume-up, temp-24.</p>

      <div className="form-grid tri">
        <label>
          Device Name
          <input
            value={newDeviceName}
            onChange={(e) => setNewDeviceName(e.target.value)}
            placeholder="TV1"
          />
        </label>

        <label>
          Device Type
          <select value={newDeviceType} onChange={(e) => setNewDeviceType(e.target.value)}>
            {DEVICE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label>
          First Command
          <input
            value={newCommandName}
            onChange={(e) => setNewCommandName(e.target.value)}
            placeholder="power"
          />
        </label>
      </div>

      <button onClick={onLearn} disabled={disabled}>Learn First Command</button>
    </section>
  );
}

function DeviceCard({
  device,
  busy,
  learnInput,
  setLearnInput,
  editingDevice,
  renameValue,
  setRenameValue,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onLearn,
  onSend,
  onDelete,
}) {
  const commandNames = Object.keys(device.commands || {}).sort((a, b) => a.localeCompare(b));
  const isEditing = editingDevice === device.deviceName;

  return (
    <article className="card device-card">
      <header className="device-head">
        <div>
          <h3>{device.deviceName}</h3>
          <span className="type-pill">{device.type || "UNKNOWN"}</span>
        </div>

        {!isEditing ? (
          <button className="secondary" onClick={() => onStartRename(device.deviceName)} disabled={busy}>
            Rename
          </button>
        ) : (
          <div className="row-actions">
            <button onClick={() => onSaveRename(device.deviceName)} disabled={busy}>Save</button>
            <button className="secondary" onClick={onCancelRename} disabled={busy}>Cancel</button>
          </div>
        )}
      </header>

      {isEditing && (
        <label className="inline-field">
          New Name
          <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="New device name" />
        </label>
      )}

      <section className="commands-block">
        <h4>Commands</h4>
        {commandNames.length === 0 ? (
          <p className="subtle">No commands saved yet.</p>
        ) : (
          <div className="command-list">
            {commandNames.map((commandName) => (
              <div key={commandName} className="command-row">
                <span className="command-name">{commandName}</span>
                <div className="row-actions">
                  <button onClick={() => onSend(device.deviceName, commandName)} disabled={busy}>Send</button>
                  <button className="danger" onClick={() => onDelete(device.deviceName, commandName)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="learn-inline">
        <label className="inline-field">
          Learn New Command
          <input
            value={learnInput}
            onChange={(e) => setLearnInput(device.deviceName, e.target.value)}
            placeholder="e.g. mute"
          />
        </label>
        <button onClick={() => onLearn(device)} disabled={busy || !learnInput.trim()}>Learn</button>
      </section>
    </article>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [devices, setDevices] = useState([]);
  const [newDeviceName, setNewDeviceName] = useState("TV1");
  const [newDeviceType, setNewDeviceType] = useState("TV");
  const [newCommandName, setNewCommandName] = useState("power");

  const [learnInputs, setLearnInputs] = useState({});
  const [editingDevice, setEditingDevice] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready.");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setDevices([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => a.deviceName.localeCompare(b.deviceName)),
    [devices]
  );

  const canSubmitAuth = useMemo(() => email.trim() && password.trim(), [email, password]);

  async function getToken() {
    return user.getIdToken();
  }

  async function refreshDevices(token, statusMessage = "Device list refreshed.") {
    const payload = await apiCall("/api/devices", { method: "GET", token });
    setDevices(payload.devices || []);
    setMessage(statusMessage);
  }

  async function runAction(action, fn) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      setMessage(`${action} failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      setBusy(true);
      try {
        const token = await user.getIdToken();
        const payload = await apiCall("/api/devices", { method: "GET", token });
        if (!cancelled) {
          setDevices(payload.devices || []);
          setMessage("Loaded your devices.");
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(`Load failed: ${error.message}`);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleEmailAuth = async (event) => {
    event.preventDefault();
    if (!canSubmitAuth) return;

    await runAction(isRegister ? "Register" : "Login", async () => {
      if (isRegister) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        setMessage("Registration successful.");
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        setMessage("Login successful.");
      }
    });
  };

  const handleGoogleLogin = async () => {
    await runAction("Google login", async () => {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setMessage("Google login successful.");
    });
  };

  const handleLogout = async () => {
    await runAction("Logout", async () => {
      await signOut(auth);
      setDevices([]);
      setLearnInputs({});
      setEditingDevice("");
      setRenameValue("");
      setMessage("Logged out.");
    });
  };

  const handleRefresh = async () => {
    if (!user) return;

    await runAction("Refresh", async () => {
      const token = await getToken();
      await refreshDevices(token);
    });
  };

  const handleLearnNewDevice = async () => {
    if (!user) return;

    const deviceName = newDeviceName.trim();
    const commandName = newCommandName.trim();

    if (!isValidName(deviceName) || !isValidName(commandName)) {
      setMessage("Device and command names can use only letters, numbers, _ and -.");
      return;
    }

    await runAction("Learn", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/learn", {
        method: "POST",
        token,
        body: {
          deviceName,
          commandName,
          deviceType: newDeviceType,
        },
      });

      await refreshDevices(token, payload.message || "Command learned.");
      setNewCommandName("power");
    });
  };

  const handleSetLearnInput = (deviceName, value) => {
    setLearnInputs((prev) => ({ ...prev, [deviceName]: value }));
  };

  const handleLearnOnDevice = async (device) => {
    if (!user) return;

    const commandName = String(learnInputs[device.deviceName] || "").trim();
    if (!isValidName(commandName)) {
      setMessage("Command name can use only letters, numbers, _ and -.");
      return;
    }

    await runAction("Learn", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/learn", {
        method: "POST",
        token,
        body: {
          deviceName: device.deviceName,
          commandName,
          deviceType: device.type,
        },
      });

      await refreshDevices(token, payload.message || `Learned ${commandName}.`);
      setLearnInputs((prev) => ({ ...prev, [device.deviceName]: "" }));
    });
  };

  const handleSendCommand = async (deviceName, commandName) => {
    if (!user) return;

    await runAction("Send", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/send", {
        method: "POST",
        token,
        body: { deviceName, commandName },
      });

      setMessage(payload.message || `Sent ${deviceName}/${commandName}.`);
    });
  };

  const handleDeleteCommand = async (deviceName, commandName) => {
    if (!user) return;

    const shouldDelete = window.confirm(`Delete ${commandName} from ${deviceName}?`);
    if (!shouldDelete) return;

    await runAction("Delete", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/command", {
        method: "DELETE",
        token,
        body: { deviceName, commandName },
      });

      await refreshDevices(token, payload.message || "Command deleted.");
    });
  };

  const handleStartRename = (deviceName) => {
    setEditingDevice(deviceName);
    setRenameValue(deviceName);
  };

  const handleCancelRename = () => {
    setEditingDevice("");
    setRenameValue("");
  };

  const handleSaveRename = async (oldDeviceName) => {
    if (!user) return;

    const newDeviceNameValue = renameValue.trim();
    if (!isValidName(newDeviceNameValue)) {
      setMessage("New device name can use only letters, numbers, _ and -.");
      return;
    }

    await runAction("Rename", async () => {
      const token = await getToken();
      const payload = await apiCall("/api/device/rename", {
        method: "PATCH",
        token,
        body: {
          oldDeviceName,
          newDeviceName: newDeviceNameValue,
        },
      });

      await refreshDevices(token, payload.message || "Device renamed.");
      setEditingDevice("");
      setRenameValue("");

      setLearnInputs((prev) => {
        const next = { ...prev };
        const oldValue = next[oldDeviceName] || "";
        delete next[oldDeviceName];
        if (oldValue) {
          next[newDeviceNameValue] = oldValue;
        }
        return next;
      });
    });
  };

  if (!authReady) {
    return (
      <main className="page">
        <section className="card">Loading authentication...</section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page">
        <AuthCard
          busy={busy}
          canSubmitAuth={canSubmitAuth}
          email={email}
          password={password}
          isRegister={isRegister}
          message={message}
          setEmail={setEmail}
          setPassword={setPassword}
          setIsRegister={setIsRegister}
          handleEmailAuth={handleEmailAuth}
          handleGoogleLogin={handleGoogleLogin}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="dashboard-shell">
        <section className="card top-bar">
          <div>
            <h1>Universal Remote Dashboard</h1>
            <p className="subtle">Signed in as {user.email}</p>
          </div>

          <div className="row-actions">
            <button className="secondary" onClick={handleRefresh} disabled={busy}>Refresh</button>
            <button onClick={handleLogout} disabled={busy}>Logout</button>
          </div>
        </section>

        <CreateDeviceCard
          newDeviceName={newDeviceName}
          setNewDeviceName={setNewDeviceName}
          newDeviceType={newDeviceType}
          setNewDeviceType={setNewDeviceType}
          newCommandName={newCommandName}
          setNewCommandName={setNewCommandName}
          onLearn={handleLearnNewDevice}
          disabled={busy}
        />

        <p className="status">{busy ? "Working..." : message}</p>

        <section>
          <h2 className="section-title">My Devices</h2>
          {sortedDevices.length === 0 ? (
            <section className="card empty-state">
              <p>No devices saved yet. Create one and learn its first command.</p>
            </section>
          ) : (
            <div className="device-grid">
              {sortedDevices.map((device) => (
                <DeviceCard
                  key={device.deviceName}
                  device={device}
                  busy={busy}
                  learnInput={learnInputs[device.deviceName] || ""}
                  setLearnInput={handleSetLearnInput}
                  editingDevice={editingDevice}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onStartRename={handleStartRename}
                  onCancelRename={handleCancelRename}
                  onSaveRename={handleSaveRename}
                  onLearn={handleLearnOnDevice}
                  onSend={handleSendCommand}
                  onDelete={handleDeleteCommand}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
