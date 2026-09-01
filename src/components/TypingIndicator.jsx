import UserAvatar from './UserAvatar.jsx';

/**
 * TypingIndicator — bouncing dots + name(s) + overlapping avatar stack.
 */
function TypingIndicator({ isTyping, typingUsers = [] }) {
  if (!isTyping) return null;

  let text = 'Someone is typing';
  let avatars = null;

  if (typingUsers.length > 0) {
    if (typingUsers.length === 1) {
      text = `${typingUsers[0].username} is typing`;
    } else if (typingUsers.length === 2) {
      text = `${typingUsers[0].username} and ${typingUsers[1].username} are typing`;
    } else {
      text = `${typingUsers[0].username}, ${typingUsers[1].username} and ${typingUsers.length - 2} others are typing`;
    }

    const shown = typingUsers.slice(0, 3);
    avatars = (
      <div className="typing-avatar-stack">
        {shown.map((u, i) => (
          <UserAvatar
            key={u.id}
            userId={u.id}
            name={u.username}
            hasAvatar={u.hasAvatar}
            size="sm"
            stackIndex={i}
            stackTotal={shown.length}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="typing-indicator"
      role="status"
      aria-label={text}
    >
      {avatars}
      <span className="typing-indicator-text">{text}</span>
      <span className="typing-dots" aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
    </div>
  );
}

export default TypingIndicator;
