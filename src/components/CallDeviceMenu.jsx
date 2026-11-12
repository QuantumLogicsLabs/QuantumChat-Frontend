import { ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Split call control: main button + caret that opens a device / option menu.
 */
export default function CallDeviceMenu({
  active = false,
  onToggle,
  ariaLabel,
  title,
  children,
  menuTitle,
  devices = [],
  selectedDeviceId = '',
  onSelectDevice,
  emptyLabel = 'No devices found',
  extraOptions = null,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`call-device-control${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`call-ctrl${active ? ' active' : ''}`}
        onClick={onToggle}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </button>
      <button
        type="button"
        className={`call-ctrl-caret${open ? ' active' : ''}`}
        aria-label={menuTitle || 'Device options'}
        aria-expanded={open}
        title={menuTitle || 'Device options'}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronUp size={14} />
      </button>
      {open ? (
        <div className="call-device-menu" role="menu">
          {menuTitle ? <div className="call-device-menu-title">{menuTitle}</div> : null}
          {devices.length === 0 ? (
            <div className="call-device-menu-empty">{emptyLabel}</div>
          ) : (
            devices.map((device) => {
              const selected = device.deviceId === selectedDeviceId;
              return (
                <button
                  key={device.deviceId || device.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`call-device-menu-item${selected ? ' is-selected' : ''}`}
                  onClick={() => {
                    onSelectDevice?.(device.deviceId);
                    setOpen(false);
                  }}
                >
                  <span className="call-device-menu-check" aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                  <span>{device.label}</span>
                </button>
              );
            })
          )}
          {extraOptions}
        </div>
      ) : null}
    </div>
  );
}
