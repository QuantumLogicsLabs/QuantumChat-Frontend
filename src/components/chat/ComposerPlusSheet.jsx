import { Paperclip, Camera, BarChart2, Calendar, Megaphone, Clock, Forward, Smile } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet.jsx';

/**
 * Nested composer actions — attach / camera / group tools / disappear.
 */
export default function ComposerPlusSheet({
  open,
  onClose,
  onAttach,
  onCamera,
  onPoll,
  onEvent,
  onAnnounce,
  showGroupTools = false,
  canAnnounce = false,
  disappearSeconds = 0,
  onCycleDisappear,
  allowForward = true,
  onToggleForward,
  forwardUntilSeconds = 0,
  onCycleForwardUntil,
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="More actions">
      <div className="qc-composer-plus-grid" role="menu">
        <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => { onAttach?.(); onClose(); }}>
          <Paperclip size={20} />
          <span>Attach file</span>
        </button>
        <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => { onCamera?.(); onClose(); }}>
          <Camera size={20} />
          <span>Camera</span>
        </button>
        {showGroupTools ? (
          <>
            <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => { onPoll?.(); onClose(); }}>
              <BarChart2 size={20} />
              <span>Poll</span>
            </button>
            <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => { onEvent?.(); onClose(); }}>
              <Calendar size={20} />
              <span>Event</span>
            </button>
            {canAnnounce ? (
              <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => { onAnnounce?.(); onClose(); }}>
                <Megaphone size={20} />
                <span>Announce</span>
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => onCycleDisappear?.()}>
          <Clock size={20} />
          <span>
            Disappear
            {disappearSeconds > 0 ? ` · ${disappearSeconds}s` : ' · off'}
          </span>
        </button>
        <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => onToggleForward?.()}>
          <Forward size={20} />
          <span>Forwarding {allowForward ? 'on' : 'off'}</span>
        </button>
        {allowForward ? (
          <button type="button" role="menuitem" className="qc-composer-plus-item" onClick={() => onCycleForwardUntil?.()}>
            <Smile size={20} />
            <span>
              Forward until
              {forwardUntilSeconds > 0 ? ` · ${forwardUntilSeconds}s` : ' · forever'}
            </span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
