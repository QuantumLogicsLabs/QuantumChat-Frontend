import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StoryLocalPreview,
  StoryPublishControls,
  useStoryPublishOptions,
} from './StoryPublishControls.jsx';

const MAX_CHARS = 700;

const BACKGROUNDS = [
  { id: 'midnight', label: 'Midnight', fill: '#0b1020' },
  { id: 'ocean', label: 'Ocean', fill: '#0d47a1' },
  { id: 'forest', label: 'Forest', fill: '#1b5e20' },
  { id: 'ember', label: 'Ember', fill: '#b71c1c' },
  { id: 'plum', label: 'Plum', fill: '#4a148c' },
  { id: 'sand', label: 'Sand', fill: '#5d4037' },
  { id: 'slate', label: 'Slate', fill: '#37474f' },
  { id: 'rose', label: 'Rose', fill: '#ad1457' },
  {
    id: 'aurora',
    label: 'Aurora',
    fill: { type: 'linear', colors: ['#0f2027', '#203a43', '#2c5364'] },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    fill: { type: 'linear', colors: ['#ff512f', '#dd2476'] },
  },
  {
    id: 'mint',
    label: 'Mint',
    fill: { type: 'linear', colors: ['#11998e', '#38ef7d'] },
  },
  {
    id: 'gold',
    label: 'Gold',
    fill: { type: 'linear', colors: ['#f7971e', '#ffd200'] },
  },
];

const FONTS = [
  { id: 'classic', label: 'Classic', family: 'system-ui, Segoe UI, sans-serif', weight: 600 },
  { id: 'modern', label: 'Modern', family: 'Georgia, "Times New Roman", serif', weight: 500 },
  { id: 'bold', label: 'Bold', family: 'Impact, Haettenschweiler, sans-serif', weight: 700 },
  { id: 'typewriter', label: 'Type', family: '"Courier New", Courier, monospace', weight: 600 },
  { id: 'script', label: 'Script', family: 'Georgia, "Palatino Linotype", cursive', weight: 500 },
];

const ALIGNS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];
const TEXT_COLORS = ['#ffffff', '#111827', '#fef08a', '#fda4af', '#86efac', '#93c5fd'];
const EMOJIS = ['😊', '❤️', '🔥', '✨', '🎉', '😂', '🙏', '🌈'];

function cssBackground(fill) {
  if (typeof fill === 'string') return fill;
  if (fill?.type === 'linear' && Array.isArray(fill.colors)) {
    return `linear-gradient(160deg, ${fill.colors.join(', ')})`;
  }
  return '#0b1020';
}

function paintFill(ctx, fill, w, h) {
  if (typeof fill === 'string') {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (fill?.type === 'linear' && Array.isArray(fill.colors) && fill.colors.length) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    const last = fill.colors.length - 1;
    fill.colors.forEach((c, i) => grad.addColorStop(last === 0 ? 0 : i / last, c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, w, h);
}

function wrapLines(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        if (line) lines.push(line);
        if (ctx.measureText(word).width <= maxWidth) {
          line = word;
        } else {
          // Hard-break very long tokens
          let chunk = '';
          for (const ch of word) {
            const tryChunk = chunk + ch;
            if (ctx.measureText(tryChunk).width <= maxWidth) chunk = tryChunk;
            else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

/** Render styled text status to a compressed JPEG (posts as a sealed image story). */
export async function renderTextStoryToFile(text, {
  backgroundId,
  fontId,
  align,
  textColor = '#ffffff',
  fontSize: requestedFontSize,
  position = { x: 50, y: 50 },
  rotation = 0,
  italic = false,
  underline = false,
  shadow = true,
}) {
  const bg = BACKGROUNDS.find((b) => b.id === backgroundId) || BACKGROUNDS[0];
  const font = FONTS.find((f) => f.id === fontId) || FONTS[0];
  const textAlign = ['left', 'center', 'right'].includes(align) ? align : 'center';

  // 720×1280 JPEG keeps sealed download/decrypt snappy vs a full-bleed PNG.
  const W = 720;
  const H = 1280;
  const padX = 56;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  paintFill(ctx, bg.fill, W, H);

  const raw = String(text || '').trim().slice(0, MAX_CHARS);
  let fontSize = Number(requestedFontSize) || (raw.length > 220 ? 36 : raw.length > 120 ? 44 : raw.length > 60 ? 54 : 64);
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.font = `${italic ? 'italic ' : ''}${font.weight} ${fontSize}px ${font.family}`;

  let lines = wrapLines(ctx, raw, W - padX * 2);
  while (lines.length * fontSize * 1.25 > H * 0.72 && fontSize > 28) {
    fontSize -= 2;
    ctx.font = `${italic ? 'italic ' : ''}${font.weight} ${fontSize}px ${font.family}`;
    lines = wrapLines(ctx, raw, W - padX * 2);
  }

  const lineHeight = fontSize * 1.28;
  const blockH = lines.length * lineHeight;
  let y = (H * (position.y / 100)) - blockH / 2 + lineHeight / 2;
  ctx.textAlign = textAlign;
  const x = W * (position.x / 100);
  ctx.save();
  ctx.translate(x, y + blockH / 2 - lineHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-x, -(y + blockH / 2 - lineHeight / 2));
  if (shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
  }

  for (const line of lines) {
    ctx.fillText(line, x, y);
    if (underline) {
      const width = ctx.measureText(line).width;
      const start = textAlign === 'left' ? x : textAlign === 'right' ? x - width : x - width / 2;
      ctx.fillRect(start, y + fontSize * 0.42, width, Math.max(1, fontSize / 16));
    }
    y += lineHeight;
  }
  ctx.restore();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not render text status'))),
      'image/jpeg',
      0.82
    );
  });
  return new File([blob], `text-status-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

export default function TextStoryComposer({ friends = [], onCancel, onConfirm, uploading, onError }) {
  const [text, setText] = useState('');
  const [backgroundId, setBackgroundId] = useState(BACKGROUNDS[0].id);
  const [fontId, setFontId] = useState(FONTS[0].id);
  const [align, setAlign] = useState('center');
  const [textColor, setTextColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(64);
  const [textPosition, setTextPosition] = useState({ x: 50, y: 50 });
  const [textRotation, setTextRotation] = useState(0);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [shadow, setShadow] = useState(true);
  const textDragRef = useRef(null);
  const textRotateRef = useRef(null);
  const [textHistory, setTextHistory] = useState([]);
  const [textFuture, setTextFuture] = useState([]);
  const [rendering, setRendering] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const opts = useStoryPublishOptions();

  const bg = useMemo(
    () => BACKGROUNDS.find((b) => b.id === backgroundId) || BACKGROUNDS[0],
    [backgroundId]
  );
  const font = useMemo(() => FONTS.find((f) => f.id === fontId) || FONTS[0], [fontId]);
  const busy = uploading || rendering;
  const canPost = text.trim().length > 0 && !busy;
  function rememberTextPosition(previous) {
    setTextHistory((items) => [...items.slice(-19), previous]);
    setTextFuture([]);
  }
  function undoTextTransform() {
    const previous = textHistory.at(-1);
    if (!previous) return;
    setTextFuture((items) => [{ position: textPosition, rotation: textRotation }, ...items]);
    setTextPosition(previous.position);
    setTextRotation(previous.rotation);
    setTextHistory((items) => items.slice(0, -1));
  }
  function redoTextTransform() {
    const next = textFuture[0];
    if (!next) return;
    setTextHistory((items) => [...items, { position: textPosition, rotation: textRotation }]);
    setTextPosition(next.position);
    setTextRotation(next.rotation);
    setTextFuture((items) => items.slice(1));
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function submit(status) {
    if (!canPost) return;
    setRendering(true);
    try {
      const options = opts.buildOptions(status);
      const file = await renderTextStoryToFile(text, { backgroundId, fontId, align, textColor, fontSize, position: textPosition, rotation: textRotation, italic, underline, shadow });
      await onConfirm?.(file, opts.computeTtlMs(), opts.allowReplies, options);
    } catch (err) {
      onError?.(err?.message || 'Could not create text status');
    } finally {
      setRendering(false);
    }
  }

  async function handlePreview() {
    if (!text.trim()) return;
    setRendering(true);
    try {
      const file = await renderTextStoryToFile(text, { backgroundId, fontId, align, textColor, fontSize, position: textPosition, rotation: textRotation, italic, underline, shadow });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      onError?.(err?.message || 'Could not preview text status');
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="story-composer-overlay text-story-overlay" onClick={busy ? undefined : onCancel}>
      <div className="text-story-composer" onClick={(e) => e.stopPropagation()}>
        <div className="story-composer-top">
          <span>Text status</span>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel">
            ×
          </button>
        </div>

        <div
          className="text-story-canvas"
          style={{
            background: cssBackground(bg.fill),
            fontFamily: font.family,
            fontWeight: font.weight,
            textAlign: align,
            color: textColor,
            fontSize: `${Math.min(64, Math.max(28, fontSize))}px`,
          }}
          onPointerMove={(event) => {
            const drag = textDragRef.current;
            const rect = event.currentTarget.getBoundingClientRect();
            if (drag) {
              drag.moved = true;
              setTextPosition({
                x: Math.min(96, Math.max(4, drag.position.x + ((event.clientX - drag.startX) / rect.width) * 100)),
                y: Math.min(96, Math.max(4, drag.position.y + ((event.clientY - drag.startY) / rect.height) * 100)),
              });
            }
            const rotate = textRotateRef.current;
            if (rotate) {
              rotate.moved = true;
              const angle = Math.atan2(event.clientY - rotate.centerY, event.clientX - rotate.centerX) * (180 / Math.PI) + 90;
              setTextRotation(Math.round(angle * 10) / 10);
            }
          }}
          onPointerUp={() => {
            if (textDragRef.current?.moved) {
              rememberTextPosition(textDragRef.current.initial);
            }
            if (textRotateRef.current?.moved) {
              rememberTextPosition(textRotateRef.current.initial);
            }
            textDragRef.current = null;
            textRotateRef.current = null;
          }}
          onPointerCancel={() => {
            textDragRef.current = null;
            textRotateRef.current = null;
          }}
        >
          <textarea
            className="text-story-input"
            value={text}
            maxLength={MAX_CHARS}
            disabled={busy}
            placeholder="Type a status…"
            aria-label="Status text"
            onChange={(e) => setText(e.target.value)}
            style={{
              position: 'absolute',
              left: `${textPosition.x}%`,
              top: `${textPosition.y}%`,
              transform: `translate(-50%, -50%) rotate(${textRotation}deg)`,
              fontStyle: italic ? 'italic' : 'normal',
              textDecoration: underline ? 'underline' : 'none',
              textShadow: shadow ? '0 2px 4px rgba(0,0,0,.4)' : 'none',
              color: textColor,
            }}
            onPointerDown={(event) => {
              if (busy) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              textDragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                position: textPosition,
                initial: { position: textPosition, rotation: textRotation },
                moved: false,
              };
            }}
            autoFocus
          />
          <button
            type="button"
            className="text-story-rotate-handle"
            aria-label={`Rotate text, current angle ${Math.round(textRotation)} degrees`}
            onPointerDown={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.parentElement.getBoundingClientRect();
              textRotateRef.current = {
                pointerId: event.pointerId,
                centerX: rect.left + rect.width / 2,
                centerY: rect.top + rect.height / 2,
                initial: { position: textPosition, rotation: textRotation },
                moved: false,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
          >
            ↻ {Math.round(textRotation)}°
          </button>
        </div>

        <div className="text-story-options">
          <p className="story-composer-ttl-label">Background</p>
          <div className="text-story-swatches" role="group" aria-label="Background">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`text-story-swatch${backgroundId === b.id ? ' active' : ''}`}
                style={{ background: cssBackground(b.fill) }}
                title={b.label}
                aria-label={b.label}
                disabled={busy}
                onClick={() => setBackgroundId(b.id)}
              />
            ))}
          </div>

          <p className="story-composer-ttl-label">Font</p>
          <div className="text-story-chip-row" role="group" aria-label="Font style">
            {FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`text-story-chip${fontId === f.id ? ' active' : ''}`}
                style={{ fontFamily: f.family, fontWeight: f.weight }}
                disabled={busy}
                onClick={() => setFontId(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p className="story-composer-ttl-label">Align</p>
          <div className="text-story-chip-row" role="group" aria-label="Text alignment">
            {ALIGNS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`text-story-chip${align === a.id ? ' active' : ''}`}
                disabled={busy}
                onClick={() => setAlign(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>

          <p className="story-composer-ttl-label">Text color and size</p>
          <div className="text-story-chip-row" role="group" aria-label="Text color">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`text-story-color-chip${textColor === color ? ' active' : ''}`}
                style={{ background: color }}
                aria-label={`Text color ${color}`}
                onClick={() => setTextColor(color)}
                disabled={busy}
              />
            ))}
            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} aria-label="Custom text color" disabled={busy} />
          </div>
          <label className="text-story-size">
            Text size
            <input type="range" min="28" max="96" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} disabled={busy} />
          </label>
          <div className="text-story-emoji-row" role="group" aria-label="Add emoji">
            {EMOJIS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => setText((current) => `${current}${emoji}`.slice(0, MAX_CHARS))} disabled={busy}>{emoji}</button>
            ))}
          </div>
          <div className="text-story-chip-row" role="group" aria-label="Text effects">
            <button type="button" className="text-story-chip" onClick={undoTextTransform} disabled={busy || !textHistory.length}>Undo</button>
            <button type="button" className="text-story-chip" onClick={redoTextTransform} disabled={busy || !textFuture.length}>Redo</button>
            <button type="button" className={`text-story-chip${italic ? ' active' : ''}`} onClick={() => setItalic((value) => !value)} disabled={busy}>Italic</button>
            <button type="button" className={`text-story-chip${underline ? ' active' : ''}`} onClick={() => setUnderline((value) => !value)} disabled={busy}>Underline</button>
            <button type="button" className={`text-story-chip${shadow ? ' active' : ''}`} onClick={() => setShadow((value) => !value)} disabled={busy}>Shadow</button>
          </div>

          <p className="text-story-charcount">
            {text.length}/{MAX_CHARS}
          </p>
        </div>

        <StoryPublishControls
          opts={opts}
          friends={friends}
          busy={busy}
          canSubmit={canPost}
          onPreview={handlePreview}
          onDraft={() => submit('draft')}
          onSchedule={() => submit('scheduled')}
          onPost={() => submit('published')}
          postLabel="Post status"
        />
      </div>
      {previewFile && previewUrl && (
        <StoryLocalPreview
          file={previewFile}
          previewUrl={previewUrl}
          onClose={() => {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
}
