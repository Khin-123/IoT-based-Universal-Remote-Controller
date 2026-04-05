import React from "react";

export default function ACControls({ isLearnMode, disabled, onAction }) {
  const [temp, setTemp] = React.useState(24);
  const [mode, setMode] = React.useState("cool");

  return (
    <section className="device-panel">
      <h3>AC Controls</h3>
      <div className="button-row">
        <button disabled={disabled} onClick={() => onAction("on")}>On</button>
        <button disabled={disabled} onClick={() => onAction("off")}>Off</button>
      </div>

      <div className="field">
        <label>Temperature: {temp}C</label>
        <input
          type="range"
          min="17"
          max="25"
          value={temp}
          onChange={(e) => setTemp(Number(e.target.value))}
          disabled={disabled}
        />
        <button disabled={disabled} onClick={() => onAction("temp", { value: temp })}>
          {isLearnMode ? "Learn This Temp" : "Set Temperature"}
        </button>
      </div>

      <div className="field">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={disabled}>
          <option value="fan">Fan</option>
          <option value="cool">Cooling</option>
          <option value="heat">Heating</option>
        </select>
        <button disabled={disabled} onClick={() => onAction("mode", { value: mode })}>
          {isLearnMode ? "Learn This Mode" : "Set Mode"}
        </button>
      </div>
    </section>
  );
}
