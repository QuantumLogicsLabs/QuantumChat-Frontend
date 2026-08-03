import { useTheme, FUN_THEMES } from '../context/ThemeContext.jsx';

const MODE_OPTIONS = [
  {
    id: 'light',
    label: 'Light Theme',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
  {
    id: 'dark',
    label: 'Dark Theme',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    ),
  },
  {
    id: 'eyecare',
    label: 'Eyecare Theme',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

// Add a new dreamy theme here — id must match FUN_THEMES in ThemeContext.jsx
// and a [data-theme='id'] block in index.css. swatch is any CSS background
// value (reuse the theme's --accent-gradient for a quick preview).
const FUN_OPTIONS = [
  {
    id: 'moonveil',
    label: 'Moonveil',
    swatch: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 55%, #c4b5fd 100%)',
  },
  {
    id: 'sakura',
    label: 'Sakura',
    swatch: 'linear-gradient(135deg, #db2777 0%, #ec4899 55%, #f9a8d4 100%)',
  },
   {
    id: 'sunset',
    label: 'Sunset Ember',
    swatch: 'linear-gradient(135deg, #ea580c 0%, #fb923c 45%, #f472b6 100%)',
 },
  {
    id: 'aurora',
    label: 'Aurora',
    swatch: 'linear-gradient(135deg, #0d9488 0%, #2dd4bf 45%, #a78bfa 100%)',
  },
  {
    id: 'ocean',
    label: 'Bioluminescent',
    swatch: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 55%, #99f6e4 100%)',
  },
  {
    id: 'nebula',
    label: 'Nebula',
    swatch: 'linear-gradient(135deg, #7c3aed 0%, #d946ef 50%, #60a5fa 100%)',
  },
  {
  id: 'dreamcloud',
  label: 'Dreamcloud',
  swatch: 'linear-gradient(135deg, #d946af 0%, #e879c9 50%, #d8b4fe 100%)',
},
];

// Light / Dark / Eyecare — the practical/accessibility trio. Unchanged
// behavior wherever this was already rendered (e.g. auth pages).
export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-switcher">
      {MODE_OPTIONS.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          className={`theme-switcher-btn ${theme === id ? 'active' : ''}`}
          onClick={() => setTheme(id)}
          title={label}
          aria-label={`Switch to ${label}`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

// Dreamy/fun skins (Moonveil, and whatever comes next) — deliberately a
// separate control from the mode switcher above.
export function FunThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  if (!FUN_THEMES.length) return null;

  return (
    <div className="theme-fun-switcher">
      {FUN_OPTIONS.map(({ id, label, swatch }) => (
        <button
          key={id}
          type="button"
          className={`theme-fun-btn ${theme === id ? 'active' : ''}`}
          onClick={() => setTheme(id)}
          aria-pressed={theme === id}
        >
          <span className="theme-fun-swatch" style={{ background: swatch }} aria-hidden="true" />
          <span className="theme-fun-label">{label}</span>
        </button>
      ))}
    </div>
  );
}