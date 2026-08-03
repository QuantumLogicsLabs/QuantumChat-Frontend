import {
  Copy,
  Forward,
  Pencil,
  Pin,
  Reply,
  Smile,
  Star,
  Trash2,
} from 'lucide-react';
import BottomSheet from '../ui/BottomSheet.jsx';
import { QUICK_REACTIONS } from '../../utils/emojis.js';

/**
 * Long-press message action sheet (mobile) + quick reactions.
 */
export default function MessageActionSheet({
  open,
  onClose,
  message,
  isMine,
  onReply,
  onReact,
  onCopy,
  onForward,
  onEdit,
  onDelete,
  onStar,
  onPin,
  starred = false,
  pinned = false,
  canEdit = false,
  canForward = true,
}) {
  if (!message) return null;

  const run = (fn) => {
    fn?.(message);
    onClose?.();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Message">
      <div className="qc-msg-actions-reactions" role="group" aria-label="Quick reactions">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="qc-msg-reaction-chip"
            onClick={() => run(() => onReact?.(message, emoji))}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="qc-msg-reaction-chip more"
          onClick={() => run(() => onReact?.(message, null))}
          aria-label="More reactions"
        >
          <Smile size={18} />
        </button>
      </div>
      <div className="qc-msg-actions-list" role="menu">
        <button type="button" role="menuitem" onClick={() => run(onReply)}>
          <Reply size={18} /> Reply
        </button>
        <button type="button" role="menuitem" onClick={() => run(onCopy)}>
          <Copy size={18} /> Copy
        </button>
        {canForward ? (
          <button type="button" role="menuitem" onClick={() => run(onForward)}>
            <Forward size={18} /> Forward
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" role="menuitem" onClick={() => run(onEdit)}>
            <Pencil size={18} /> Edit
          </button>
        ) : null}
        <button type="button" role="menuitem" onClick={() => run(onStar)}>
          <Star size={18} /> {starred ? 'Unstar' : 'Star'}
        </button>
        <button type="button" role="menuitem" onClick={() => run(onPin)}>
          <Pin size={18} /> {pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>
          <Trash2 size={18} /> Delete{isMine ? '' : ' for me'}
        </button>
      </div>
    </BottomSheet>
  );
}
