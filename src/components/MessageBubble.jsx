import AttachmentBubble from './AttachmentBubble.jsx';

export default function MessageBubble({ message, isMine, resolveKeys }) {
  return (
    <div className={`message-row ${isMine ? 'mine' : 'theirs'}`}>
      <div className={`message-bubble ${isMine ? 'mine' : 'theirs'}`}>
        {message.attachment && <AttachmentBubble attachment={message.attachment} resolveKeys={resolveKeys} />}
        {message.text ? message.text : message.text === null ? <em>[Unable to decrypt message]</em> : null}
        <div className="message-time">{new Date(message.createdAt).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
