import { useMemo } from 'react';

const STAR_COUNT = 55;

function randomStars(count) {
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      id: i,
      top: Math.random() * 100,
      left: Math.random() * 100,
      size: Math.random() * 2 + 1, // 1-3px
      delay: Math.random() * 3.2,
      duration: 2.4 + Math.random() * 2.4,
    });
  }
  return stars;
}

// Purely decorative — rendered only while theme === 'moonveil'.
// aria-hidden + pointer-events:none (set in CSS) so it never affects
// accessibility or interaction.
export default function MoonveilFX() {
  const stars = useMemo(() => randomStars(STAR_COUNT), []);

  return (
    <div className="moonveil-fx" aria-hidden="true">
      {stars.map((s) => (
        <span
          key={s.id}
          className="moonveil-star"
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
      <div className="moonveil-moon">
        <div className="moonveil-crater c1" />
        <div className="moonveil-crater c2" />
        <div className="moonveil-crater c3" />
        <div className="moonveil-crater c4" />
      </div>
    </div>
  );
}