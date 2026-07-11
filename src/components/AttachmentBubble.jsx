import { useState } from 'react';
import client from '../api/client.js';
import { unsealBytes } from '../crypto/keys.js';

function FileIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default function AttachmentBubble({ attachment, isMine, resolveAttachmentKey }) {
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [preview, setPreview] = useState(null);

  // Attachments are sealed to the recipient only, so the sender's own
  // keyring never has the matching private key — this isn't a bug, it's the
  // same "public key can't decrypt" guarantee applied to files.
  const mySecretKey = resolveAttachmentKey(attachment);
  if (!mySecretKey) {
    return (
      <div className="attachment-chip attachment-chip-disabled">
        <span className="attachment-filename">
          <FileIcon className="file-icon" />
          <span>{attachment.filename}</span>
        </span>
        <span className="attachment-note">{isMine ? 'only the recipient can open this' : "can't decrypt on this device"}</span>
      </div>
    );
  }

  async function handleFetch() {
    setStatus('loading');
    try {
      const res = await client.get(`/attachments/${attachment.id}/raw`, { responseType: 'arraybuffer' });
      const cipherBytes = new Uint8Array(res.data);
      const plainBytes = unsealBytes(cipherBytes, attachment, mySecretKey);
      if (!plainBytes) {
        setStatus('error');
        return;
      }

      const blob = new Blob([plainBytes], { type: attachment.mimetype });
      const url = URL.createObjectURL(blob);

      if (attachment.mimetype.startsWith('image/')) {
        setPreview(url);
        setStatus('idle');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus('idle');
      }
    } catch (err) {
      setStatus('error');
    }
  }

  if (preview) {
    return <img className="attachment-preview" src={preview} alt={attachment.filename} />;
  }

  if (status === 'loading' && attachment.mimetype.startsWith('image/')) {
    return <div className="skeleton attachment-preview-placeholder" />;
  }

  return (
    <div className="attachment-chip">
      <span className="attachment-filename">
        <FileIcon className="file-icon" />
        <span>{attachment.filename}</span>
      </span>
      <button type="button" onClick={handleFetch} disabled={status === 'loading'}>
        {status === 'loading' ? 'Decrypting…' : status === 'error' ? 'Failed — retry' : 'Open'}
      </button>
    </div>
  );
}
