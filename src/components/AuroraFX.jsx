import { useMemo } from 'react';

const STAR_COUNT = 70;

function randomStars(count) {
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    const bright = Math.random() > 0.82;
    stars.push({
      id: i,
      top: Math.random() * 42,
      left: Math.random() * 100,
      size: bright ? Math.random() * 1.4 + 1.8 : Math.random() * 1.2 + 0.6,
      delay: Math.random() * 4,
      duration: bright ? 3 + Math.random() * 2 : 2 + Math.random() * 3,
      bright,
    });
  }
  return stars;
}

// A row of jagged pine-tree silhouettes — used twice: once upright along the
// shoreline, once flipped/faded beneath it as the water reflection.
function TreeRow({ className }) {
  return (
    <svg className={className} viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 120 L0 100 L18 100 L24 78 L14 78 L28 54 L18 54 L34 26 L22 26 L38 2 L54 26 L42 26 L58 54 L48 54 L62 78 L52 78 L58 100 L90 100 L96 84 L86 84 L100 60 L90 60 L106 34 L94 34 L112 6 L130 34 L118 34 L134 60 L124 60 L138 84 L128 84 L134 100 L190 100 L196 88 L186 88 L202 66 L190 66 L208 40 L196 40 L214 10 L232 40 L220 40 L238 66 L226 66 L244 88 L232 88 L238 100 L340 100 L346 82 L336 82 L352 56 L340 56 L358 26 L346 26 L364 0 L382 26 L370 26 L388 56 L376 56 L394 82 L382 82 L388 100 L520 100 L526 86 L516 86 L532 62 L520 62 L538 34 L526 34 L544 4 L562 34 L550 34 L568 62 L556 62 L574 86 L562 86 L568 100 L640 100 L646 84 L636 84 L650 60 L640 60 L656 34 L644 34 L662 6 L680 34 L668 34 L684 60 L674 60 L688 84 L676 84 L684 100 L760 100 L766 90 L758 90 L770 72 L760 72 L774 52 L764 52 L778 28 L792 52 L782 52 L796 72 L786 72 L800 90 L800 120 Z" />
    </svg>
  );
}

// Purely decorative — rendered only while theme === 'aurora'.
export default function AuroraFX() {
  const stars = useMemo(() => randomStars(STAR_COUNT), []);

  return (
    <div className="aurora-fx" aria-hidden="true">
      <div className="aurora-night-sky" />

      {stars.map((s) => (
        <span
          key={s.id}
          className={`aurora-star ${s.bright ? 'bright' : ''}`}
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}

      <div className="aurora-moon-glow" />
      <div className="aurora-moon" />

      {/* Soft, blurred glow bands — no hard shapes. Two layers drifting at
          different speeds give the color a slow, layered "3D" motion. */}
      <div className="aurora-lights aurora-lights-1" />
      <div className="aurora-lights aurora-lights-2" />
      <div className="aurora-rays" />
      <div className="aurora-sky-fade" />

      <div className="aurora-shooting-star aurora-shooting-star-1" />
      <div className="aurora-shooting-star aurora-shooting-star-2" />

      {/* Shoreline: snow ridge + trees, right at the horizon */}
      
      <TreeRow className="aurora-trees" />

      {/* Water: a softened, vertically-flipped mirror of the lights + trees,
          fading out toward the bottom for a reflective-lake look. */}
      <div className="aurora-water">
        <div className="aurora-water-lights aurora-lights-1" />
        <div className="aurora-water-lights aurora-lights-2" />
        <TreeRow className="aurora-trees-reflection" />
        <div className="aurora-water-fade" />
        <div className="aurora-water-ripple" />
      </div>
    </div>
  );
}