export function AuthCard({
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

export function VerifyEmailCard({ busy, status, email, onRefresh, onResend, onLogout }) {
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

export function RemotePicker({
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
            {remotes.map((remote) => (
              <article
                key={remote.remoteId}
                className={`device-item ${selectedRemoteId === remote.remoteId ? "active" : ""}`}
                onClick={() => onSelect(remote.remoteId)}
              >
                <div className="device-item-top">
                  <strong>{remote.name || remote.remoteId}</strong>
                  <span className="badge">{remote.remoteId}</span>
                </div>
                <div className="device-item-actions">
                  <button
                    className="danger tiny"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(remote.remoteId);
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
