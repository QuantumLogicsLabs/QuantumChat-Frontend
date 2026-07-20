/**
 * MessageSearch.jsx
 *
 * On-device search over decrypted message texts (inverted index + TF scoring).
 * The server never sees the query or plaintext.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { buildIndex, searchIndex } from '../utils/localSearchIndex.js';

/**
 * Formats a timestamp for display in search results.
 * @param {string|number|Date} timestamp - The message timestamp
 * @returns {string} Formatted time string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Truncates text to a maximum length with an ellipsis.
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum character count
 * @returns {string}
 */
function truncateText(text, maxLength = 80) {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength) + '…';
}

/**
 * MessageSearch component
 *
 * @param {Object}   props
 * @param {Array}    props.messages       - Array of message objects with { id, text, timestamp }
 * @param {function} props.onResultSelect - Callback invoked with the message ID when a result is clicked
 * @param {boolean}  props.isOpen         - Whether the search bar is visible
 * @param {function} props.onClose        - Callback to close the search bar
 */
function MessageSearch({ messages = [], onResultSelect, isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    setQuery('');
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const index = useMemo(() => buildIndex(messages), [messages]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchIndex(index, query);
  }, [query, index]);

  const handleResultClick = useCallback(
    (messageId) => {
      onResultSelect(messageId);
      onClose();
    },
    [onResultSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="message-search" role="search" aria-label="Search messages">
      <div className="message-search-input-wrapper">
        <svg
          className="message-search-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>

        <input
          ref={inputRef}
          className="message-search-input"
          type="text"
          placeholder="Search messages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search messages input"
        />

        <button
          className="message-search-close"
          onClick={onClose}
          type="button"
          aria-label="Close search"
        >
          ✕
        </button>
      </div>

      <p className="message-search-hint">On-device index · server never sees this query</p>

      {query.trim() && (
        <div className="message-search-results" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <div className="message-search-empty">No messages found</div>
          ) : (
            results.map((msg) => (
              <button
                key={msg.id}
                className="message-search-item"
                onClick={() => handleResultClick(msg.id)}
                type="button"
                role="option"
                aria-label={`Go to message: ${truncateText(msg.text, 40)}`}
              >
                <span className="message-search-item-text">{truncateText(msg.text)}</span>
                {msg.timestamp && (
                  <span className="message-search-item-time">{formatTimestamp(msg.timestamp)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default MessageSearch;
