import { Users, Info, X } from 'lucide-react';
import UserAvatar from '../UserAvatar.jsx';
import IconButton from '../ui/IconButton.jsx';

/**
 * Desktop info panel — peer/group summary docked as third column.
 */
export default function InfoPanel({
  open,
  onClose,
  selected,
  users = [],
  onOpenProfile,
  onOpenGroupSettings,
  children,
}) {
  if (!open) return null;

  const isGroup = selected?.type === 'group';
  const peer =
    selected?.peer ||
    users.find((u) => String(u.id) === String(selected?.id));

  return (
    <aside className="qc-info-panel" aria-label="Chat details">
      <header className="qc-info-panel-header">
        <h2>Details</h2>
        <IconButton label="Close details" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {selected ? (
        <div className="qc-info-panel-body">
          <div className="qc-info-hero">
            {isGroup ? (
              <span className="avatar group-avatar qc-info-avatar">
                <Users size={28} strokeWidth={2} aria-hidden="true" />
              </span>
            ) : (
              <UserAvatar
                userId={selected.id}
                name={selected.title}
                hasAvatar={Boolean(peer?.hasAvatar)}
                className="qc-info-avatar"
              />
            )}
            <h3>{selected.title}</h3>
            {selected.subtitle ? <p>{selected.subtitle}</p> : null}
          </div>
          <div className="qc-info-actions">
            {isGroup ? (
              <button type="button" className="qc-info-action" onClick={onOpenGroupSettings}>
                <Info size={16} /> Group settings
              </button>
            ) : (
              <button type="button" className="qc-info-action" onClick={() => onOpenProfile?.(selected.id)}>
                <Info size={16} /> View profile
              </button>
            )}
          </div>
          {children}
        </div>
      ) : (
        <div className="qc-empty-state qc-empty-state--compact">
          <p>Select a chat to see details</p>
        </div>
      )}
    </aside>
  );
}
