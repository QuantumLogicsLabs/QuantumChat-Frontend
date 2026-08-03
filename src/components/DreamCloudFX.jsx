import { useMemo } from 'react';

const SPARKLE_COUNT = 40;
const CLOUD_COUNT = 7;

function randomSparkles(count) {
  const sparkles = [];
  const tints = ['#ffffff', '#f472b6', '#c084fc'];
  for (let i = 0; i < count; i += 1) {
    sparkles.push({
      id: i,
      top: Math.random() * 100,
      left: Math.random() * 100,
      size: Math.random() * 4 + 4,
      delay: Math.random() * 5,
      duration: 2.5 + Math.random() * 3,
      color: tints[i % tints.length],
    });
  }
  return sparkles;
}

function randomClouds(count) {
  const clouds = [];
  for (let i = 0; i < count; i += 1) {
    clouds.push({
      id: i,
      top: 4 + Math.random() * 60,
      scale: 0.8 + Math.random() * 1.1,
      duration: 50 + Math.random() * 40,
      delay: -Math.random() * 60,
      opacity: 0.7 + Math.random() * 0.28,
      reverse: i % 2 === 0,
    });
  }
  return clouds;
}

function Cloud({ style, className }) {
  return (
    <svg className={className} style={style} viewBox="0 0 200 90" aria-hidden="true">
      <path d="M40 70 Q18 70 18 50 Q18 32 38 32 Q42 14 66 14 Q90 14 96 32 Q118 30 124 48 Q140 48 140 62 Q140 74 124 74 L40 74 Z" />
    </svg>
  );
}

// Purely decorative — rendered only while theme === 'dreamcloud'.
export default function DreamCloudFX() {
  const sparkles = useMemo(() => randomSparkles(SPARKLE_COUNT), []);
  const clouds = useMemo(() => randomClouds(CLOUD_COUNT), []);

  return (
    <div className="dreamcloud-fx" aria-hidden="true">
      <div className="dreamcloud-sky" />

      {clouds.map((c) => (
        <Cloud
          key={c.id}
          className={`dreamcloud-cloud ${c.reverse ? 'reverse' : ''}`}
          style={{
            top: `${c.top}%`,
            transform: `scale(${c.scale})`,
            opacity: c.opacity,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
        />
      ))}

      {sparkles.map((s) => (
        <span
          key={s.id}
          className="dreamcloud-sparkle"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: s.color,
            boxShadow: `0 0 6px 1px ${s.color}`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
    </div>
  );
}