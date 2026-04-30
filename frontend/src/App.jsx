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
import { auth } from "./firebase";
import { apiCall } from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { DeviceSidebar } from "./components/DeviceSidebar";
import { AuthCard, RemotePicker, VerifyEmailCard } from "./components/SetupPanels";
import { TerminalPanel } from "./components/TerminalPanel";
import {
  DEFAULT_CONTROL_VALUES,
  isValidName,
  normalizeDeviceType,
  suggestNextDeviceName,
} from "./deviceUtils";
import "./App.css";

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
    () => sortedDevices.find((device) => device.deviceName === activeDeviceName) || null,
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

      setPendingLearnCount((count) => count + 1);
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
          onToggle={() => setIsRegister((value) => !value)}
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
        <DeviceSidebar
          busy={busy}
          devices={sortedDevices}
          activeDeviceName={activeDeviceName}
          draftType={draftType}
          viewMode={viewMode}
          onAddDevice={beginAddDevice}
          onRefresh={handleRefresh}
          onOpenSend={openDeviceSendMode}
          onOpenEdit={openDeviceEditMode}
          onDelete={handleDeleteDevice}
        />

        <section className="right-panel">
          <ControlPanel
            activeDevice={activeDevice}
            activeType={activeType}
            busy={busy}
            canSaveEdit={canSaveEdit}
            canSaveNew={canSaveNew}
            controlValues={controlValues}
            controlsDisabled={controlsDisabled}
            draftDeviceName={draftDeviceName}
            draftType={draftType}
            editDeviceName={editDeviceName}
            panelTitle={panelTitle}
            viewMode={viewMode}
            onExecuteCommand={executeCommand}
            onSaveEdit={handleSaveEdit}
            onSaveNewDevice={handleSaveNewDevice}
            setControlValues={setControlValues}
            setDraftDeviceName={setDraftDeviceName}
            setEditDeviceName={setEditDeviceName}
          />

          <TerminalPanel logs={logs} status={status} />
        </section>
      </section>
    </main>
  );
}
