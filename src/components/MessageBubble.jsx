import AttachmentBubble from './AttachmentBubble.jsx';

export default function MessageBubble({ message, isMine, resolveAttachmentKey, grouped }) {
  return (
    <div className={`message-row ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}>
      <div className={`message-bubble ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}>
        {message.attachment && (
          <AttachmentBubble attachment={message.attachment} isMine={isMine} resolveAttachmentKey={resolveAttachmentKey} />
        )}
        {message.text ? message.text : message.text === null ? <em>[Unable to decrypt message]</em> : null}
        <div className="message-time">{new Date(message.createdAt).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
