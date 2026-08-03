import { useTheme, APP_ICONS } from '../context/ThemeContext.jsx';

export default function BrandLogo({ className = '', size, alt = 'QuantumChat' }) {
  const { appIcon } = useTheme();
  const icon = APP_ICONS.find((i) => i.id === appIcon) || APP_ICONS[0];

  return (
    <img
      src={icon.file}
      alt={alt}
      className={['brand-logo', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  );
}