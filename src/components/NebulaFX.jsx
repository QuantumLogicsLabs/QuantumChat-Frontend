import { useMemo } from 'react';

const STAR_COUNT = 70;

function randomStardust(count) {
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      id: i,
      top: Math.random() * 100,
      left: Math.random() * 100,
      size: Math.random() * 2.6 + 1,
      delay: Math.random() * 3.5,
      duration: 2 + Math.random() * 2.8,
      hue: ['pink', 'blue', 'gold'][Math.floor(Math.random() * 3)],
    });
  }
  return stars;
}

// Purely decorative — rendered only while theme === 'nebula'.
export default function NebulaFX() {
  const stars = useMemo(() => randomStardust(STAR_COUNT), []);

  return (
    <div className="nebula-fx" aria-hidden="true">
      <div className="nebula-arm nebula-arm-1" />
      <div className="nebula-arm nebula-arm-2" />
      <div className="nebula-arm nebula-arm-3" />
      <div className="nebula-spiral" />
      <div className="nebula-core-glow" />
      <div className="nebula-core" />
      <div className="nebula-flare" />

      {stars.map((s) => (
        <span
          key={s.id}
          className={`nebula-star nebula-star-${s.hue}`}
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

      <div className="nebula-shooting-star nebula-shooting-star-1" />
      <div className="nebula-shooting-star nebula-shooting-star-2" />
      <div className="nebula-shooting-star nebula-shooting-star-3" />
    </div>
  );
}