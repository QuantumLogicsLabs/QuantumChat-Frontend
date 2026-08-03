import { forwardRef } from 'react';

/**
 * Accessible icon button with 44px minimum tap target.
 */
const IconButton = forwardRef(function IconButton(
  {
    children,
    className = '',
    label,
    active = false,
    accent = false,
    danger = false,
    type = 'button',
    disabled = false,
    onClick,
    title,
    ...rest
  },
  ref,
) {
  const classes = [
    'qc-icon-btn',
    active ? 'active' : '',
    accent ? 'accent' : '',
    danger ? 'danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-label={label || title}
      title={title || label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
