import { labelForMode } from "../deviceUtils";

function SliderCommand({
  label,
  value,
  min,
  max,
  commandPrefix,
  controlsDisabled, 
  viewMode,
  onChange,
  onExecute,
  decreaseLabel,
  increaseLabel,
}) {
  return (
    <>
      <span className="mini-label">{label} ({value})</span>
      <div className="slider-learn-row">
        <button
          type="button"
          className="edge-btn ghost"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={controlsDisabled}
          aria-label={decreaseLabel}
        >
          -
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={controlsDisabled}
        />
        <button
          type="button"
          className="edge-btn ghost"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={controlsDisabled}
          aria-label={increaseLabel}
        >
          +
        </button>
        <button
          className="tiny-cta"
          onClick={() => onExecute(`${commandPrefix}_${value}`)}
          disabled={controlsDisabled}
        >
          {viewMode === "send" ? "Send" : "Learn"}
        </button>
      </div>
    </>
  );
}

export function ControlPanel({
  activeDevice,
  activeType,
  busy,
  canSaveEdit,
  canSaveNew,
  controlValues,
  controlsDisabled,
  draftDeviceName,
  draftType,
  editDeviceName,
  panelTitle,
  viewMode,
  onExecuteCommand,
  onSaveEdit,
  onSaveNewDevice,
  setControlValues,
  setDraftDeviceName,
  setEditDeviceName,
}) {
  const updateControlValue = (key, value) => {
    setControlValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
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
                    <button onClick={() => onExecuteCommand("power_on")} disabled={controlsDisabled}>On</button>
                    <button className="ghost" onClick={() => onExecuteCommand("power_off")} disabled={controlsDisabled}>Off</button>
                  </div>
                </div>

                <div className="ac-mode">
                  <span className="mini-label-acmode">Mode</span>
                  <div className="control-actions mode-actions">
                    <button
                      className={controlValues.acMode === "cooling" ? "active-choice" : ""}
                      onClick={async () => {
                        updateControlValue("acMode", "cooling");
                        await onExecuteCommand("mode_cooling");
                      }}
                      disabled={controlsDisabled}
                    >
                      Cooling
                    </button>
                    <button
                      className={controlValues.acMode === "fan" ? "active-choice" : ""}
                      onClick={async () => {
                        updateControlValue("acMode", "fan");
                        await onExecuteCommand("mode_fan");
                      }}
                      disabled={controlsDisabled}
                    >
                      Fan
                    </button>
                    <button
                      className={controlValues.acMode === "heating" ? "active-choice" : ""}
                      onClick={async () => {
                        updateControlValue("acMode", "heating");
                        await onExecuteCommand("mode_heating");
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
                  <span className="mini-label">Temp ({controlValues.acTemp}Â°C)</span>
                  <div className="slider-learn-row">
                    <button
                      type="button"
                      className="edge-btn ghost"
                      onClick={() => updateControlValue("acTemp", Math.max(17, controlValues.acTemp - 1))}
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
                      onChange={(e) => updateControlValue("acTemp", Number(e.target.value))}
                      disabled={controlsDisabled}
                    />
                    <button
                      type="button"
                      className="edge-btn ghost"
                      onClick={() => updateControlValue("acTemp", Math.min(25, controlValues.acTemp + 1))}
                      disabled={controlsDisabled}
                      aria-label="Increase temperature"
                    >
                      +
                    </button>
                    <button
                      className="tiny-cta"
                      onClick={() => onExecuteCommand(`temp_${controlValues.acTemp}`)}
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
                  <button onClick={() => onExecuteCommand("power")} disabled={controlsDisabled}>Power</button>
                </div>
              </div>

              <div className="control-row tv-sliders-row">
                <div className="tv-slider-card">
                  <span className="mini-label">Volume</span>
                  <div className="control-actions mode-actions">
                    <button onClick={() => onExecuteCommand("volume_up")} disabled={controlsDisabled}>Volume +</button>
                    <button className="ghost" onClick={() => onExecuteCommand("volume_down")} disabled={controlsDisabled}>Volume -</button>
                  </div>
                </div>

                <div className="tv-slider-card">
                  <span className="mini-label">Channel</span>
                  <div className="control-actions mode-actions">
                    <button onClick={() => onExecuteCommand("channel_up")} disabled={controlsDisabled}>Channel +</button>
                    <button className="ghost" onClick={() => onExecuteCommand("channel_down")} disabled={controlsDisabled}>Channel -</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeType === "FAN" && (
            <>
              <div className="control-row command-row">
                <div className="control-actions mode-actions">
                  <button onClick={() => onExecuteCommand("power")} disabled={controlsDisabled}>Power</button>
                  <button onClick={() => onExecuteCommand("turn")} disabled={controlsDisabled}>Turn</button>
                  <button onClick={() => onExecuteCommand("led")} disabled={controlsDisabled}>Led</button>
                  <button onClick={() => onExecuteCommand("timer")} disabled={controlsDisabled}>Timer</button>
                </div>
              </div>

              <div className="control-row">
                <SliderCommand
                  label="Speed"
                  value={controlValues.fanSpeed}
                  min={1}
                  max={3}
                  commandPrefix="speed"
                  controlsDisabled={controlsDisabled}
                  viewMode={viewMode}
                  onChange={(value) => updateControlValue("fanSpeed", value)}
                  onExecute={onExecuteCommand}
                  decreaseLabel="Decrease speed"
                  increaseLabel="Increase speed"
                />
              </div>
            </>
          )}

          {activeType === "PROJECTOR" && (
            <div className="control-row command-row">
              <div className="control-actions mode-actions">
                <button onClick={() => onExecuteCommand("power")} disabled={controlsDisabled}>Power On</button>
                <button className="ghost" onClick={() => onExecuteCommand("power_off")} disabled={controlsDisabled}>Power Off</button>
                <button onClick={() => onExecuteCommand("ok")} disabled={controlsDisabled}>OK</button>
              </div>
            </div>
          )}

          {activeType === "LIGHT" && (
            <>
              <div className="control-row command-row">
                <div className="control-actions mode-actions">
                  <button onClick={() => onExecuteCommand("on")} disabled={controlsDisabled}>On</button>
                  <button className="ghost" onClick={() => onExecuteCommand("off")} disabled={controlsDisabled}>Off</button>
                  <button onClick={() => onExecuteCommand("red")} disabled={controlsDisabled}>R</button>
                  <button onClick={() => onExecuteCommand("green")} disabled={controlsDisabled}>G</button>
                  <button onClick={() => onExecuteCommand("blue")} disabled={controlsDisabled}>B</button>
                  <button onClick={() => onExecuteCommand("white")} disabled={controlsDisabled}>W</button>
                </div>
              </div>

              <div className="control-row command-row">
                <div className="control-actions mode-actions">
                  <button onClick={() => onExecuteCommand("brightness_up")} disabled={controlsDisabled}>+</button>
                  <button onClick={() => onExecuteCommand("brightness_down")} disabled={controlsDisabled}>-</button>
                  <button onClick={() => onExecuteCommand("flash")} disabled={controlsDisabled}>Flash</button>
                  <button onClick={() => onExecuteCommand("strobe")} disabled={controlsDisabled}>Strobe</button>
                  <button onClick={() => onExecuteCommand("fade")} disabled={controlsDisabled}>Fade</button>
                  <button onClick={() => onExecuteCommand("smooth")} disabled={controlsDisabled}>Smooth</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <footer className="control-footer">
        {viewMode === "add" && (
          <button onClick={onSaveNewDevice} disabled={!canSaveNew || busy}>Save Device</button>
        )}
        {viewMode === "edit" && (
          <button onClick={onSaveEdit} disabled={!canSaveEdit || busy}>Save Changes</button>
        )}
      </footer>
    </section>
  );
}
