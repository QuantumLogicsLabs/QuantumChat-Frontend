/**
 * Calm empty / locked / offline states for the thread pane.
 */
export default function ChatEmptyState({
  variant = 'welcome',
  title,
  copy,
  actionLabel,
  onAction,
}) {
  const presets = {
    welcome: {
      title: 'Welcome to QuantumChat',
      copy: 'Pick a conversation or start a new group. Your messages stay encrypted on this device.',
    },
    locked: {
      title: 'Unlock your encryption keys',
      copy: 'Import keys.txt for this account to start chatting securely.',
    },
    offline: {
      title: 'You are offline',
      copy: 'Reconnect to send and receive messages. Drafts stay on this device.',
    },
    noResults: {
      title: 'No conversations found',
      copy: 'Try another search, or clear filters to see everyone again.',
    },
    thread: {
      title: 'No messages yet',
      copy: 'Say hello — your first encrypted message starts the thread.',
    },
  };

  const preset = presets[variant] || presets.welcome;

  return (
    <div className={`qc-empty-state qc-empty-state--${variant}`} role="status">
      <div className="qc-empty-state-card">
        <h2>{title || preset.title}</h2>
        <p>{copy || preset.copy}</p>
        {actionLabel && onAction ? (
          <button type="button" className="qc-empty-state-cta" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
