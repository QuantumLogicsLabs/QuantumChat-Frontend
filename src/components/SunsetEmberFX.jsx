import { useMemo } from 'react';

const EMBER_COUNT = 26;
const BIRD_COUNT = 4;

function randomEmbers(count) {
  const embers = [];
  for (let i = 0; i < count; i += 1) {
    embers.push({
      id: i,
      left: Math.random() * 100,
      size: Math.random() * 3 + 2,
      delay: Math.random() * 8,
      duration: 7 + Math.random() * 6,
      drift: Math.random() * 40 - 20,
    });
  }
  return embers;
}

function randomBirds(count) {
  const birds = [];
  for (let i = 0; i < count; i += 1) {
    birds.push({
      id: i,
      top: 20 + Math.random() * 22,
      delay: Math.random() * 24,
      duration: 18 + Math.random() * 10,
      scale: 0.6 + Math.random() * 0.6,
    });
  }
  return birds;
}

// Purely decorative — rendered only while theme === 'sunset'.
export default function SunsetEmberFX() {
  const embers = useMemo(() => randomEmbers(EMBER_COUNT), []);
  const birds = useMemo(() => randomBirds(BIRD_COUNT), []);

  return (
    <div className="sunset-fx" aria-hidden="true">
      <div className="sunset-sky" />
      <div className="sunset-cloud sunset-cloud-1" />
      <div className="sunset-cloud sunset-cloud-2" />
      <div className="sunset-cloud sunset-cloud-3" />

      {birds.map((b) => (
        <svg
          key={b.id}
          className="sunset-bird"
          viewBox="0 0 24 12"
          style={{
            top: `${b.top}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            '--bird-scale': b.scale,
          }}
        >
          <path d="M0 6 Q6 0 12 6 Q18 0 24 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ))}

      <div className="sunset-sun-halo" />
      <div className="sunset-sun" />

      <div className="sunset-horizon-wash" />
      <div className="sunset-horizon-line" />

      <svg className="sunset-mountains sunset-mountains-back" viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 100 L0 55 L40 30 L80 60 L130 20 L180 50 L230 35 L280 65 L330 25 L370 55 L400 40 L400 100 Z" />
      </svg>
      <div className="sunset-heat-haze" />
      <svg className="sunset-mountains sunset-mountains-front" viewBox="0 0 400 100" preserveAspectRatio="none">
        <path d="M0 100 L0 70 L50 45 L100 75 L150 40 L210 72 L260 50 L310 78 L360 48 L400 65 L400 100 Z" />
      </svg>

      {embers.map((e) => (
        <span
          key={e.id}
          className="sunset-ember"
          style={{
            left: `${e.left}%`,
            width: `${e.size}px`,
            height: `${e.size}px`,
            animationDelay: `${e.delay}s`,
            animationDuration: `${e.duration}s`,
            '--drift': `${e.drift}px`,
          }}
        />
      ))}
    </div>
  );
}