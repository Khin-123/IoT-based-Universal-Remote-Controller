import React from "react";

export default function FanControls({ isLearnMode, disabled, onAction }) {
  const [speed, setSpeed] = React.useState(1);

  return (
    <section className="device-panel">
      <h3>Fan Controls</h3>
      <div className="button-row">
        <button disabled={disabled} onClick={() => onAction("power")}>Power</button>
      </div>

      <div className="field">
        <label>Speed: {speed}</label>
        <input
          type="range"
          min="1"
          max="3"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          disabled={disabled}
        />
        <button disabled={disabled} onClick={() => onAction("speed", { value: speed })}>
          {isLearnMode ? "Learn This Speed" : "Set Speed"}
        </button>
      </div>
    </section>
  );
}
