export default function ActionButton({ label, action, onAction, disabled }) {
  return (
    <button disabled={disabled} onClick={() => onAction(action)} type="button">
      {label}
    </button>
  );
}
