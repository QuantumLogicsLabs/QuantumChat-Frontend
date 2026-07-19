import { useEffect, useRef, useState } from 'react';
import client from '../api/client.js';
import { unsealBytes } from '../crypto/keys.js';
import { attachmentIdOf, normalizeAttachment, pickAttachmentEnvelope } from '../crypto/voiceCache.js';

function FileIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MicIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function DownloadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function kindOf(attachment) {
  const mime = (attachment?.mimetype || '').toLowerCase();
  const name = (attachment?.filename || '').toLowerCase();
  if (mime.startsWith('audio/') || /\.(webm|ogg|mp3|m4a|wav|aac)$/i.test(name) || /^voice-note/i.test(name)) {
    return 'audio';
  }
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) return 'video';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mime.includes('word') ||
    mime.includes('officedocument.wordprocessing') ||
    /\.(docx?|odt|rtf)$/i.test(name)
  ) {
    return 'word';
  }
  if (mime.includes('zip') || mime.includes('compressed') || /\.(zip|rar|7z|tar|gz)$/i.test(name)) {
    return 'zip';
  }
  if (mime.startsWith('text/') || /\.(txt|md|csv|json|log)$/i.test(name)) return 'text';
  return 'file';
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(kind) {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'word') return 'Word';
  if (kind === 'zip') return 'Archive';
  if (kind === 'text') return 'Text';
  if (kind === 'video') return 'Video';
  if (kind === 'image') return 'Image';
  if (kind === 'audio') return 'Audio';
  return 'File';
}

function VoicePlayer({ url }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, [url]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  }

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <button type="button" className="voice-play-btn" onClick={togglePlay} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>
      <div className="voice-wave">
        <div className="voice-wave-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
      <span className="voice-duration">{formatDuration(duration)}</span>
    </div>
  );
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.click();
}

export default function AttachmentBubble({
  attachment: rawAttachment,
  isMine,
  resolveSecretKey,
  resolveAttachmentKey,
  onImagePreview,
  onImageReady,
}) {
  const attachment = normalizeAttachment(rawAttachment);
  const [status, setStatus] = useState('idle');
  const [objectUrl, setObjectUrl] = useState(null);
  const [textPreview, setTextPreview] = useState(null);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const kind = kindOf(attachment);
  const attachmentId = attachmentIdOf(attachment);
  const keyResolver = resolveSecretKey || resolveAttachmentKey;
  const opened = pickAttachmentEnvelope(attachment, keyResolver);
  const autoPreview = kind === 'audio' || kind === 'image' || kind === 'video' || kind === 'pdf' || kind === 'text';

  useEffect(() => {
    let revoked = null;
    let cancelled = false;

    async function load() {
      if (!autoPreview || !attachmentId || !opened) return;

      setStatus('loading');
      try {
        const res = await client.get(`/attachments/${attachmentId}/raw`, { responseType: 'arraybuffer' });
        if (cancelled) return;
        const plainBytes = unsealBytes(new Uint8Array(res.data), opened.envelope, opened.secretKey);
        if (!plainBytes) {
          setStatus('error');
          return;
        }

        const mime =
          attachment.mimetype ||
          (kind === 'audio'
            ? 'audio/webm'
            : kind === 'pdf'
              ? 'application/pdf'
              : kind === 'image'
                ? 'image/jpeg'
                : kind === 'video'
                  ? 'video/mp4'
                  : kind === 'text'
                    ? 'text/plain'
                    : 'application/octet-stream');

        if (kind === 'text') {
          const text = new TextDecoder().decode(plainBytes).slice(0, 4000);
          setTextPreview(text);
          const url = URL.createObjectURL(new Blob([plainBytes], { type: mime }));
          revoked = url;
          setObjectUrl(url);
        } else {
          const url = URL.createObjectURL(new Blob([plainBytes], { type: mime }));
          revoked = url;
          setObjectUrl(url);
          if (kind === 'image' && onImageReady) {
            onImageReady(attachmentId, url, attachment.filename);
          }
        }
        setStatus('idle');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [
    autoPreview,
    attachmentId,
    opened?.secretKey,
    opened?.envelope?.nonce,
    opened?.envelope?.targetPublicKey,
    attachment?.mimetype,
    attachment?.filename,
    kind,
  ]);

  if (!attachment) return null;

  if (!opened) {
    return (
      <div className="attachment-chip attachment-chip-disabled">
        <span className="attachment-filename">
          {kind === 'audio' ? <MicIcon className="file-icon" /> : <FileIcon className="file-icon" />}
          <span>{kind === 'audio' ? 'Voice note' : attachment.filename}</span>
        </span>
        <span className="attachment-note">
          {status === 'loading'
            ? 'Decrypting…'
            : isMine
              ? 'only the recipient can open this'
              : "can't decrypt on this device"}
        </span>
      </div>
    );
  }

  async function handleManualOpen() {
    setStatus('loading');
    try {
      const res = await client.get(`/attachments/${attachmentId}/raw`, { responseType: 'arraybuffer' });
      const plainBytes = unsealBytes(new Uint8Array(res.data), opened.envelope, opened.secretKey);
      if (!plainBytes) {
        setStatus('error');
        return;
      }
      const mime = attachment.mimetype || 'application/octet-stream';
      const blob = new Blob([plainBytes], { type: mime });
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      triggerDownload(url, attachment.filename);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  function handleDownload() {
    if (objectUrl) {
      triggerDownload(objectUrl, attachment.filename);
      return;
    }
    handleManualOpen();
  }

  if (kind === 'audio' && objectUrl) {
    return <VoicePlayer url={objectUrl} />;
  }

  if (kind === 'image' && objectUrl) {
    return (
      <div className="attachment-media">
        <img
          className="attachment-preview"
          src={objectUrl}
          alt={attachment.filename}
          onClick={() => onImagePreview?.(attachmentId, objectUrl, attachment.filename)}
          role="button"
          aria-label="Open image gallery"
        />
        <button type="button" className="attachment-download-fab" onClick={handleDownload} aria-label="Download image">
          <DownloadIcon className="file-icon" />
        </button>
      </div>
    );
  }

  if (kind === 'video' && objectUrl) {
    return (
      <div className="attachment-media">
        <video className="attachment-video" src={objectUrl} controls playsInline preload="metadata" />
        <button type="button" className="attachment-download-fab" onClick={handleDownload} aria-label="Download video">
          <DownloadIcon className="file-icon" />
        </button>
      </div>
    );
  }

  if (kind === 'pdf' && objectUrl) {
    return (
      <div className="attachment-doc">
        <div className="attachment-doc-header">
          <span className="attachment-type-badge">PDF</span>
          <span className="attachment-filename-text">{attachment.filename}</span>
          {attachment.size ? <span className="attachment-note">({formatFileSize(attachment.size)})</span> : null}
        </div>
        {pdfExpanded ? (
          <iframe className="attachment-pdf" src={objectUrl} title={attachment.filename} />
        ) : (
          <button type="button" className="attachment-pdf-thumb" onClick={() => setPdfExpanded(true)}>
            <FileIcon className="file-icon" />
            <span>Preview PDF</span>
          </button>
        )}
        <div className="attachment-doc-actions">
          {!pdfExpanded && (
            <button type="button" onClick={() => setPdfExpanded(true)}>
              Preview
            </button>
          )}
          <button type="button" onClick={handleDownload}>
            Download
          </button>
        </div>
      </div>
    );
  }

  if (kind === 'text' && (textPreview != null || objectUrl)) {
    return (
      <div className="attachment-doc">
        <div className="attachment-doc-header">
          <span className="attachment-type-badge">TXT</span>
          <span className="attachment-filename-text">{attachment.filename}</span>
        </div>
        {textPreview != null && <pre className="attachment-text-preview">{textPreview}</pre>}
        <div className="attachment-doc-actions">
          <button type="button" onClick={handleDownload}>
            Download
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading' && autoPreview) {
    if (kind === 'audio') {
      return (
        <div className="attachment-chip attachment-chip-voice">
          <span className="attachment-filename">
            <MicIcon className="file-icon" />
            <span>Decrypting voice note…</span>
          </span>
        </div>
      );
    }
    return <div className="skeleton attachment-preview-placeholder" />;
  }

  if (status === 'error' && autoPreview) {
  return (
    <div className="attachment-chip">
      <span className="attachment-filename">
        <FileIcon className="file-icon" />
        <span>{attachment.filename}</span>
      </span>
        <button type="button" onClick={handleManualOpen}>
          Retry download
        </button>
      </div>
    );
  }

  return (
    <div className={`attachment-chip ${kind === 'audio' ? 'attachment-chip-voice' : ''}`}>
      <span className="attachment-filename">
        {kind === 'audio' ? <MicIcon className="file-icon" /> : <FileIcon className="file-icon" />}
        <span className="attachment-type-badge">{typeLabel(kind)}</span>
        <span>{kind === 'audio' ? 'Voice note' : attachment.filename}</span>
        {attachment.size ? <span className="attachment-note">({formatFileSize(attachment.size)})</span> : null}
      </span>
      <button type="button" onClick={handleManualOpen} disabled={status === 'loading'}>
        {status === 'loading' ? 'Decrypting…' : status === 'error' ? 'Failed — retry' : 'Download'}
      </button>
    </div>
  );
}
