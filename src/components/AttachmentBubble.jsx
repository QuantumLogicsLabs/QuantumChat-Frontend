import { useState } from 'react';
import client from '../api/client.js';
import { decryptBytes } from '../crypto/keys.js';

export default function AttachmentBubble({ attachment, resolveKeys }) {
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [preview, setPreview] = useState(null);

  async function handleFetch() {
    setStatus('loading');
    try {
      const { mySecretKey, otherPublicKeyAtTime } = resolveKeys(attachment);
      if (!mySecretKey) {
        setStatus('error');
        return;
      }

      const res = await client.get(`/attachments/${attachment.id}/raw`, { responseType: 'arraybuffer' });
      const cipherBytes = new Uint8Array(res.data);
      const plainBytes = decryptBytes(cipherBytes, attachment.nonce, otherPublicKeyAtTime, mySecretKey);
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

  return (
    <div className="attachment-chip">
      <span>{attachment.filename}</span>
      <button type="button" onClick={handleFetch} disabled={status === 'loading'}>
        {status === 'loading' ? 'Decrypting…' : status === 'error' ? 'Failed — retry' : 'Open'}
      </button>
    </div>
  );
}
