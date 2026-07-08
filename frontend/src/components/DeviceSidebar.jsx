import { DEVICE_TYPE_OPTIONS, normalizeDeviceType } from "../deviceUtils";

export function AddDevicesPanel({
  busy,
  draftType,
  viewMode,
  onAddDevice,
}) {
  return (
    <section className="left-section compact">
      <h3>Add Device</h3>
      <div className="type-grid">
        {DEVICE_TYPE_OPTIONS.map((type) => (
          <button
            key={type}
            className={`type-button ${viewMode === "add" && draftType === type ? "active" : ""}`}
            onClick={() => onAddDevice(type)}
            disabled={busy}
          >
            {type}
          </button>
        ))}
      </div>
    </section>
  );
}

export function MyDevicesPanel({
  busy,
  devices,
  activeDeviceName,
  onRefresh,
  onOpenSend,
  onOpenEdit,
  onDelete,
}) {
  return (
    <section className="left-section device-list-section">
      <div className="section-head">
        <h3>My Devices</h3>
        <button className="ghost tiny" onClick={onRefresh} disabled={busy}>Refresh</button>
      </div>

      {devices.length === 0 ? (
        <p className="muted">No devices.</p>
      ) : (
        <div className="device-list">
          {devices.map((device) => {
            const isActive = device.deviceName === activeDeviceName;
            return (
              <article
                key={device.deviceName}
                className={`device-item ${isActive ? "active" : ""}`}
                onClick={() => onOpenSend(device.deviceName)}
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
                      onOpenEdit(device.deviceName);
                    }}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  <button
                    className="danger tiny"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(device.deviceName);
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
  );
}

export function DeviceSidebar({
  busy,
  devices,
  activeDeviceName,
  draftType,
  viewMode,
  onAddDevice,
  onRefresh,
  onOpenSend,
  onOpenEdit,
  onDelete,
}) {
  return (
    <aside className="left-panel glass-card">
      <AddDevicesPanel
        busy={busy}
        draftType={draftType}
        viewMode={viewMode}
        onAddDevice={onAddDevice}
      />

      <MyDevicesPanel
        busy={busy}
        devices={devices}
        activeDeviceName={activeDeviceName}
        onRefresh={onRefresh}
        onOpenSend={onOpenSend}
        onOpenEdit={onOpenEdit}
        onDelete={onDelete}
      />
    </aside>
  );
}
