import useVisualViewport from '../../hooks/useVisualViewport.js';

/**
 * Outer chat chrome — neutral shell that theme skins paint over.
 */
export default function ChatShell({
  children,
  className = '',
  threadOpen = false,
  infoOpen = false,
  aiOpen = false,
}) {
  useVisualViewport(true);

  const classes = [
    'chat-page',
    'qc-shell',
    threadOpen ? 'qc-shell--thread-open' : '',
    infoOpen ? 'qc-shell--info-open' : '',
    aiOpen ? 'qc-shell--ai-open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}
