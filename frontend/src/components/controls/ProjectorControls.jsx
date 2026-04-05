export default function ProjectorControls({ disabled, onAction }) {
  return (
    <section className="device-panel">
      <h3>Projector Controls</h3>
      <div className="button-row">
        <button disabled={disabled} onClick={() => onAction("power")}>Power</button>
      </div>
    </section>
  );
}
