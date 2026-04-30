export function TerminalPanel({ logs, status }) {
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
