import { useMemo } from 'react';

const BUBBLE_COUNT = 26;

function randomBubbles(count) {
  const bubbles = [];
  for (let i = 0; i < count; i += 1) {
    bubbles.push({
      id: i,
      left: Math.random() * 100,
      size: Math.random() * 4 + 3,
      delay: Math.random() * 9,
      duration: 8 + Math.random() * 7,
      drift: Math.random() * 30 - 15,
    });
  }
  return bubbles;
}

function Jellyfish({ className, style }) {
  return (
    <svg className={`ocean-jelly ${className}`} style={style} viewBox="0 0 60 90" aria-hidden="true">
      <ellipse className="ocean-jelly-bell" cx="30" cy="26" rx="24" ry="20" />
      <path className="ocean-jelly-tentacle t1" d="M14 40 Q10 55 16 68 Q20 78 14 88" fill="none" />
      <path className="ocean-jelly-tentacle t2" d="M24 44 Q22 58 27 70 Q30 80 25 90" fill="none" />
      <path className="ocean-jelly-tentacle t3" d="M36 44 Q38 58 33 70 Q30 80 35 90" fill="none" />
      <path className="ocean-jelly-tentacle t4" d="M46 40 Q50 55 44 68 Q40 78 46 88" fill="none" />
    </svg>
  );
}

// Purely decorative — rendered only while theme === 'ocean'.
export default function OceanFX() {
  const bubbles = useMemo(() => randomBubbles(BUBBLE_COUNT), []);

  return (
    <div className="ocean-fx" aria-hidden="true">
      <div className="ocean-god-rays" />
      <Jellyfish className="ocean-jelly-1" />
      <Jellyfish className="ocean-jelly-2" />
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="ocean-bubble"
          style={{
            left: `${b.left}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            '--drift': `${b.drift}px`,
          }}
        />
      ))}
    </div>
  );
}