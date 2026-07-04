export default function DeviceSelector({ selectedDevice, onChange }) {
  const devices = [
    { value: "ac", label: "AC" },
    { value: "tv", label: "TV" },
    { value: "fan", label: "Fan" },
    { value: "projector", label: "Projector" },
    { value: "light", label: "Light" },
  ];

  return (
    <div className="field">
      <label htmlFor="device">Device</label>
      <select id="device" value={selectedDevice} onChange={(e) => onChange(e.target.value)}>
        {devices.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>
    </div>
  );
}
