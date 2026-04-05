import React from "react";

export default function TVControls({ isLearnMode, disabled, onAction }) {
  const [channel, setChannel] = React.useState(1);
  const [volume, setVolume] = React.useState(15);

  return (
    <section className="device-panel">
      <h3>TV Controls</h3>
      <div className="button-row">
        <button disabled={disabled} onClick={() => onAction("power")}>Power</button>
      </div>

      <div className="field">
        <label>Channel: {channel}</label>
        <input
          type="range"
          min="1"
          max="9"
          value={channel}
          onChange={(e) => setChannel(Number(e.target.value))}
          disabled={disabled}
        />
        <button disabled={disabled} onClick={() => onAction("channel", { value: channel })}>
          {isLearnMode ? "Learn This Channel" : "Set Channel"}
        </button>
      </div>

      <div className="field">
        <label>Volume: {volume}</label>
        <input
          type="range"
          min="0"
          max="30"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          disabled={disabled}
        />
        <button disabled={disabled} onClick={() => onAction("volume", { value: volume })}>
          {isLearnMode ? "Learn This Volume" : "Set Volume"}
        </button>
      </div>
    </section>
  );
}
