import { useMemo } from 'react';

const PETAL_COUNT = 26;

function randomPetals(count) {
  const petals = [];
  for (let i = 0; i < count; i += 1) {
    petals.push({
      id: i,
      left: Math.random() * 100,
      size: Math.random() * 8 + 10, // 10-18px
      delay: Math.random() * 10,
      duration: 9 + Math.random() * 8,
      drift: Math.random() * 60 - 30, // -30 to 30px horizontal drift
      spin: Math.random() * 360,
      opacity: Math.random() * 0.35 + 0.45,
    });
  }
  return petals;
}

// Purely decorative — rendered only while theme === 'sakura'.
// aria-hidden + pointer-events:none (set in CSS) so it never affects
// accessibility or interaction.
export default function SakuraFX() {
  const petals = useMemo(() => randomPetals(PETAL_COUNT), []);

  return (
    <div className="sakura-fx" aria-hidden="true">
      <svg className="sakura-branch" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
        <path className="sakura-branch-line" d="M150 8 C 120 20, 100 45, 78 70 C 60 92, 45 108, 20 122" fill="none" />
        <path className="sakura-branch-line sakura-branch-twig" d="M104 45 C 96 38, 90 30, 88 20" fill="none" />

        {[
          [140, 14],
          [90, 22],
          [96, 44],
          [58, 88],
          [24, 116],
        ].map(([cx, cy], idx) => (
          <g key={idx} transform={`translate(${cx} ${cy})`}>
            <circle className="sakura-petal-dot" cx="0" cy="0" r="6" />
            <circle className="sakura-petal-dot" cx="9" cy="-3" r="6" />
            <circle className="sakura-petal-dot" cx="5" cy="7" r="6" />
            <circle className="sakura-petal-dot" cx="-6" cy="5" r="6" />
            <circle className="sakura-petal-dot" cx="-4" cy="-6" r="6" />
            <circle className="sakura-blossom-center" cx="0" cy="0" r="2.5" />
          </g>
        ))}
      </svg>

      {petals.map((p) => (
        <span
          key={p.id}
          className="sakura-petal"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.8}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            opacity: p.opacity,
            '--drift': `${p.drift}px`,
            '--spin': `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}