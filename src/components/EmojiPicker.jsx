import { useRef, useEffect, useCallback, useState } from 'react';
import { COMPOSER_EMOJIS } from '../utils/emojis.js';

const EMOJI_CATEGORIES = [
  {
    label: 'Smileys',
    emojis: ['😀', '😂', '🥹', '😍', '🤩', '😎', '🥳', '🤔', '😤', '😭'],
  },
  {
    label: 'Gestures',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '💪', '🫡', '🫶'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💗', '💝'],
  },
  {
    label: 'Objects',
    emojis: ['🔥', '⭐', '🎉', '🎯', '💡', '🚀', '✅', '❌', '💬', '🔒'],
  },
];

// All emojis from categories for search
const ALL_EMOJIS = [...new Set([
  ...EMOJI_CATEGORIES.flatMap((c) => c.emojis),
  ...(COMPOSER_EMOJIS || []),
])];

export default function EmojiPicker({ onSelect, onPick, isOpen, onClose }) {
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [query, setQuery] = useState('');
  const triggerSelect = onSelect || onPick;
  const isCurrentlyOpen = isOpen !== undefined ? isOpen : true; // fallback to true if uncontrolled

  const handleEmojiClick = useCallback(
    (emoji) => {
      triggerSelect?.(emoji);
      onClose?.();
      setQuery('');
    },
    [triggerSelect, onClose]
  );

  useEffect(() => {
    if (!isCurrentlyOpen || !onClose) return;

    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        // Only trigger close if the click isn't on the toggle button
        const isToggle = event.target.closest('.attach-button');
        if (!isToggle) {
          onClose();
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCurrentlyOpen, onClose]);

  if (!isCurrentlyOpen) return null;

  // When searching, filter all known emojis; otherwise show by category
  const trimmedQuery = query.trim();
  const searchResults = trimmedQuery
    ? ALL_EMOJIS.filter((e) => e.includes(trimmedQuery))
    : [];
  const isSearching = trimmedQuery.length > 0;

  return (
    <div className="emoji-picker" ref={panelRef} role="dialog" aria-label="Emoji picker">
      <div className="emoji-picker-header">
        <span>Emojis</span>
        <button type="button" className="emoji-picker-close" onClick={onClose} aria-label="Close emoji picker">
          ×
        </button>
      </div>

      {/* Search input */}
      <div className="emoji-picker-search-wrap">
        <input
          ref={searchRef}
          className="emoji-picker-search"
          type="text"
          placeholder="Search emojis…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search emojis"
          autoComplete="off"
        />
      </div>

      {isSearching ? (
        /* Search results */
        searchResults.length > 0 ? (
          <div className="emoji-picker-grid emoji-picker-search-results">
            {searchResults.map((emoji) => (
              <button
                key={emoji}
                className="emoji-picker-btn"
                type="button"
                onClick={() => handleEmojiClick(emoji)}
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <p className="emoji-picker-empty">No emojis found</p>
        )
      ) : (
        /* Default: flat grid (COMPOSER_EMOJIS) or categorised */
        COMPOSER_EMOJIS ? (
          <div className="emoji-picker-grid">
            {ALL_EMOJIS.map((emoji) => (
              <button key={emoji} type="button" className="emoji-picker-btn" onClick={() => handleEmojiClick(emoji)} aria-label={`Insert ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          EMOJI_CATEGORIES.map((category) => (
            <div key={category.label} className="emoji-picker-category">
              <span className="emoji-picker-category-label">{category.label}</span>
              <div className="emoji-picker-grid" role="group" aria-label={`${category.label} emojis`}>
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    className="emoji-picker-btn"
                    type="button"
                    onClick={() => handleEmojiClick(emoji)}
                    aria-label={`Select ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )
      )}
    </div>
  );
}
