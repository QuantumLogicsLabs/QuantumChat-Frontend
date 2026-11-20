import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, RotateCw, ZoomIn, Undo2, Redo2 } from 'lucide-react';
import { safeStoryObjectUrl } from '../utils/storyMedia.js';

const ASPECTS = [
  { id: 'story', label: '9:16', ratio: 9 / 16 },
  { id: 'original', label: 'Original', ratio: null },
  { id: 'free', label: 'Free', ratio: 4 / 5 },
];

function isVideo(file) {
  return file?.type?.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(file?.name || '');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCropRatio(aspect, width, height) {
  return aspect === 'original' ? width / height || 9 / 16 : ASPECTS.find((item) => item.id === aspect)?.ratio || 9 / 16;
}

async function renderImage(file, state, aspect) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not read this image'));
      element.src = safeStoryObjectUrl(sourceUrl);
    });
    const ratio = getCropRatio(aspect, image.naturalWidth, image.naturalHeight);
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let cropWidth = image.naturalWidth;
    let cropHeight = image.naturalHeight;
    if (sourceRatio > ratio) cropWidth = cropHeight * ratio;
    else cropHeight = cropWidth / ratio;

    const zoom = Math.max(1, state.zoom);
    const coverScale = Math.max(cropWidth / image.naturalWidth, cropHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * coverScale * zoom;
    const drawHeight = image.naturalHeight * coverScale * zoom;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cropWidth);
    canvas.height = Math.round(cropHeight);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2 + state.x * cropWidth, canvas.height / 2 + state.y * cropHeight);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not render this image'))), 'image/jpeg', 0.92)
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-edited.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function renderVideo(file, state, aspect) {
  if (state.rotation === 0 && state.zoom === 1 && state.x === 0 && state.y === 0 && aspect === 'original') {
    return file;
  }
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = safeStoryObjectUrl(sourceUrl);
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Could not read this video'));
  });
  const ratio = getCropRatio(aspect, video.videoWidth, video.videoHeight);
  const sourceRatio = video.videoWidth / video.videoHeight;
  const cropWidth = sourceRatio > ratio ? video.videoHeight * ratio : video.videoWidth;
  const cropHeight = sourceRatio > ratio ? video.videoHeight : video.videoWidth / ratio;
  const width = Math.max(2, Math.round(cropWidth));
  const height = Math.max(2, Math.round(cropHeight));
  const canvas = document.createElement('canvas');
  canvas.width = width % 2 ? width - 1 : width;
  canvas.height = height % 2 ? height - 1 : height;
  const ctx = canvas.getContext('2d');
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream || !video.captureStream) {
    URL.revokeObjectURL(sourceUrl);
    return file;
  }
  const stream = canvas.captureStream(30);
  const sourceStream = video.captureStream();
  sourceStream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const done = new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Could not render this video'));
    recorder.onstop = () => resolve();
  });
  const draw = () => {
    if (video.ended || video.paused) return;
    const zoom = Math.max(1, state.zoom);
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2 + state.x * canvas.width, canvas.height / 2 + state.y * canvas.height);
    ctx.rotate((state.rotation * Math.PI) / 180);
    const coverScale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const drawWidth = video.videoWidth * coverScale * zoom;
    const drawHeight = video.videoHeight * coverScale * zoom;
    ctx.drawImage(video, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
    requestAnimationFrame(draw);
  };
  video.onended = () => recorder.stop();
  recorder.start(250);
  await video.play();
  draw();
  await done;
  sourceStream?.getTracks().forEach((track) => track.stop());
  URL.revokeObjectURL(sourceUrl);
  return new File([new Blob(chunks, { type: mimeType })], file.name.replace(/\.[^.]+$/, '') + '-edited.webm', { type: mimeType });
}

export default function StoryMediaEditor({ file, onCancel, onDone, onError }) {
  const video = isVideo(file);
  const previewRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [aspect, setAspect] = useState('story');
  const [state, setState] = useState({ rotation: 0, zoom: 1, x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [busy, setBusy] = useState(false);
  const [mediaRatio, setMediaRatio] = useState(9 / 16);
  const dragRef = useRef(null);
  const rotateRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(safeStoryObjectUrl(nextUrl));
    setState({ rotation: 0, zoom: 1, x: 0, y: 0 });
    setAspect('story');
    setHistory([]);
    setFuture([]);
    return () => {
      URL.revokeObjectURL(nextUrl);
      setSourceUrl((current) => (current === nextUrl ? null : current));
    };
  }, [file]);

  const aspectRatio = useMemo(() => aspect === 'original'
    ? mediaRatio
    : ASPECTS.find((item) => item.id === aspect)?.ratio || 9 / 16, [aspect, mediaRatio]);
  const previewStyle = {
    transform: `translate(${state.x * 100}%, ${state.y * 100}%) rotate(${state.rotation}deg) scale(${state.zoom})`,
  };

  function update(next) {
    setHistory((items) => [...items.slice(-19), state]);
    setFuture([]);
    setState((current) => ({ ...current, ...next }));
  }
  function reset() {
    update({ rotation: 0, zoom: 1, x: 0, y: 0 });
    setAspect('story');
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [state, ...items]);
    setState(previous);
    setHistory((items) => items.slice(0, -1));
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, state]);
    setState(next);
    setFuture((items) => items.slice(1));
  }
  function startDrag(event) {
    if (busy || event.target.closest('.story-editor-rotate-handle')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = {
        startDistance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        initial: state,
      };
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial: state,
      changed: false,
    };
  }
  function moveDrag(event) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchRef.current && pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      setState({
        ...pinchRef.current.initial,
        zoom: clamp(pinchRef.current.initial.zoom * (distance / Math.max(1, pinchRef.current.startDistance)), 1, 3),
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.changed = true;
    setState({
      ...drag.initial,
      x: clamp(drag.initial.x + (event.clientX - drag.startX) / rect.width, -0.5, 0.5),
      y: clamp(drag.initial.y + (event.clientY - drag.startY) / rect.height, -0.5, 0.5),
    });
  }
  function endDrag(event) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.changed) {
      setHistory((items) => [...items.slice(-19), drag.initial]);
      setFuture([]);
    }
    dragRef.current = null;
  }
  function handleWheel(event) {
    event.preventDefault();
    update({ zoom: clamp(state.zoom - event.deltaY * 0.0015, 1, 3) });
  }
  function startRotate(event) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    rotateRef.current = {
      pointerId: event.pointerId,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      initial: state,
      changed: false,
    };
  }
  function moveRotate(event) {
    const rotate = rotateRef.current;
    if (!rotate || rotate.pointerId !== event.pointerId) return;
    const angle = Math.atan2(event.clientY - rotate.centerY, event.clientX - rotate.centerX) * (180 / Math.PI) + 90;
    rotate.changed = true;
    setState({ ...rotate.initial, rotation: Math.round(angle * 10) / 10 });
  }
  function endRotate(event) {
    const rotate = rotateRef.current;
    if (!rotate || rotate.pointerId !== event.pointerId) return;
    if (rotate.changed) {
      setHistory((items) => [...items.slice(-19), rotate.initial]);
      setFuture([]);
    }
    rotateRef.current = null;
  }
  async function finish() {
    setBusy(true);
    try {
      const edited = video ? await renderVideo(file, state, aspect) : await renderImage(file, state, aspect);
      await onDone(edited);
    } catch (error) {
      onError?.(error.message || 'Could not edit this media');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="story-editor-overlay">
      <div className="story-media-editor" role="dialog" aria-modal="true" aria-label="Edit story media">
        <div className="story-editor-top">
          <button type="button" onClick={onCancel} disabled={busy}>Back</button>
          <strong>Edit story</strong>
          <button type="button" className="story-editor-done" onClick={finish} disabled={busy}>{busy ? 'Rendering…' : 'Done'}</button>
        </div>
        <div
          ref={previewRef}
          className="story-editor-preview"
          style={{ aspectRatio }}
          onPointerDown={startDrag}
          onPointerMove={(event) => {
            moveDrag(event);
            moveRotate(event);
          }}
          onPointerUp={(event) => {
            endDrag(event);
            endRotate(event);
          }}
          onPointerCancel={(event) => {
            endDrag(event);
            endRotate(event);
          }}
          onWheel={handleWheel}
        >
          {video
            ? <video src={safeStoryObjectUrl(sourceUrl)} style={previewStyle} onLoadedMetadata={(event) => setMediaRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight || 9 / 16)} autoPlay loop muted playsInline />
            : <img src={safeStoryObjectUrl(sourceUrl)} style={previewStyle} onLoad={(event) => setMediaRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || 9 / 16)} alt="Story edit preview" />}
          <span className="story-editor-crop-frame" aria-hidden />
          <button
            type="button"
            className="story-editor-rotate-handle"
            aria-label={`Rotate media, current angle ${Math.round(state.rotation)} degrees`}
            onPointerDown={startRotate}
          >
            ↻ <span>{Math.round(state.rotation)}°</span>
          </button>
        </div>
        <div className="story-editor-tools">
          <div className="story-editor-tool-row">
            <button type="button" onClick={() => update({ rotation: (state.rotation - 90 + 360) % 360 })}><RotateCcw size={17} />Rotate</button>
            <button type="button" onClick={() => update({ rotation: (state.rotation + 90) % 360 })}><RotateCw size={17} />Rotate</button>
            <button type="button" onClick={reset}><RotateCcw size={17} />Reset</button>
          </div>
          <div className="story-editor-tool-row">
            <button type="button" onClick={undo} disabled={!history.length}><Undo2 size={17} />Undo</button>
            <button type="button" onClick={redo} disabled={!future.length}><Redo2 size={17} />Redo</button>
            <label className="story-editor-zoom"><ZoomIn size={17} />Zoom <input type="range" min="1" max="3" step="0.05" value={state.zoom} onChange={(event) => update({ zoom: Number(event.target.value) })} /></label>
          </div>
          <div className="story-editor-aspects" role="group" aria-label="Aspect ratio">
            {ASPECTS.map((item) => <button key={item.id} type="button" className={aspect === item.id ? 'active' : ''} onClick={() => setAspect(item.id)}>{item.label}</button>)}
          </div>
          <p className="story-editor-hint">{video ? 'Video audio is preserved when the browser supports local rendering.' : 'Drag the media to reposition it inside the crop area.'}</p>
        </div>
      </div>
    </div>
  );
}
