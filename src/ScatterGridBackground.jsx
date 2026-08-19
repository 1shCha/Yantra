import { useViewport } from '@xyflow/react';

const CELL = 18;
const COLS = 24;
const ROWS = 24;
const TILE = CELL * COLS;
const SEED = 1337;

// Grid lines and shapes share this exact color/opacity so their relative
// visual weight stays the same as the pattern gets more muted overall.
const INK = 'rgba(40, 40, 36, 0.4)';

// The scatter is generated once per TILE, then several independently
// seeded copies are laid out side by side into one larger super-tile.
// A single repeating tile would put shapes at the same relative spot in
// every copy, which reads as an obvious grid once zoomed out far enough
// to see multiple repeats; mixing seeds across quadrants breaks that
// alignment while still tiling seamlessly.
const SUPER_GRID = 3;
const SUPER_COLS = COLS * SUPER_GRID;
const SUPER_ROWS = ROWS * SUPER_GRID;
const SUPER_TILE = TILE * SUPER_GRID;

// Deterministic PRNG so the "random" scatter is identical on every render
// and tiles seamlessly without needing to persist generated positions.
function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGridLines() {
  const lines = [];
  for (let i = 0; i <= SUPER_COLS; i += 1) {
    const x = i * CELL;
    lines.push(`M${x},0 L${x},${SUPER_TILE}`);
  }
  for (let j = 0; j <= SUPER_ROWS; j += 1) {
    const y = j * CELL;
    lines.push(`M0,${y} L${SUPER_TILE},${y}`);
  }
  return lines;
}

function outlinedTriangle(cx, cy, size, rotation) {
  const pts = [
    [cx, cy - size],
    [cx + size * 0.95, cy + size * 0.75],
    [cx - size * 0.95, cy + size * 0.75],
  ];
  return {
    type: 'path',
    d: trianglePath(pts, rotation, cx, cy),
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.9,
  };
}

function filledTriangle(cx, cy, size, rotation) {
  const pts = [
    [cx, cy - size],
    [cx + size * 0.95, cy + size * 0.75],
    [cx - size * 0.95, cy + size * 0.75],
  ];
  return {
    type: 'path',
    d: trianglePath(pts, rotation, cx, cy),
    fill: INK,
    stroke: 'none',
  };
}

function trianglePath(pts, rotation, cx, cy) {
  const rotated = pts.map(([x, y]) => rotatePoint(x, y, cx, cy, rotation));
  return `M${rotated[0][0].toFixed(1)},${rotated[0][1].toFixed(1)} L${rotated[1][0].toFixed(1)},${rotated[1][1].toFixed(1)} L${rotated[2][0].toFixed(1)},${rotated[2][1].toFixed(1)} Z`;
}

function rotatePoint(x, y, cx, cy, angle) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function dot(cx, cy, r) {
  return {
    type: 'circle',
    cx,
    cy,
    r,
    fill: INK,
  };
}

function isometricCube(cx, cy, size) {
  const top = [
    [cx, cy - size],
    [cx + size * 0.87, cy - size * 0.5],
    [cx, cy],
    [cx - size * 0.87, cy - size * 0.5],
  ];
  const right = [
    [cx, cy],
    [cx + size * 0.87, cy - size * 0.5],
    [cx + size * 0.87, cy + size * 0.5],
    [cx, cy + size],
  ];
  const left = [
    [cx, cy],
    [cx - size * 0.87, cy - size * 0.5],
    [cx - size * 0.87, cy + size * 0.5],
    [cx, cy + size],
  ];

  const toPath = (pts) =>
    `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;

  const facetLines = [
    `M${cx.toFixed(1)},${(cy - size).toFixed(1)} L${cx.toFixed(1)},${(cy + size).toFixed(1)}`,
    `M${(cx - size * 0.87).toFixed(1)},${(cy - size * 0.5).toFixed(1)} L${cx.toFixed(1)},${cy.toFixed(1)} L${(cx + size * 0.87).toFixed(1)},${(cy - size * 0.5).toFixed(1)}`,
  ];

  return {
    type: 'cube',
    faces: [toPath(top), toPath(right), toPath(left)],
    facetLines,
    rivet: [cx - size * 0.87, cy + size * 0.2, size * 0.16],
  };
}

function inkSpeck(cx, cy, size, rotation, rng) {
  const pointCount = 5 + Math.floor(rng() * 2);
  const pts = [];
  for (let i = 0; i < pointCount; i += 1) {
    const angle = (i / pointCount) * Math.PI * 2;
    const r = size * (0.5 + rng() * 0.6);
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  const rotated = pts.map(([x, y]) => rotatePoint(x, y, cx, cy, rotation));
  const d = `M${rotated.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`;
  return { type: 'path', d, fill: INK, stroke: 'none' };
}

// Splits the tile into an evenly spaced NxN sector grid, shuffles which
// sector each item lands in, then jitters within the sector. This keeps
// items from clustering by chance the way pure random placement would,
// while still reading as irregular because of the shuffle + jitter.
function buildSectorPositions(count, rng, coverage = 0.8) {
  const sectorsPerSide = Math.ceil(Math.sqrt(count));
  const sectorSize = TILE / sectorsPerSide;
  const sectorIndices = [];
  for (let i = 0; i < sectorsPerSide * sectorsPerSide; i += 1) {
    sectorIndices.push(i);
  }
  for (let i = sectorIndices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [sectorIndices[i], sectorIndices[j]] = [sectorIndices[j], sectorIndices[i]];
  }

  return sectorIndices.slice(0, count).map((idx) => {
    const col = idx % sectorsPerSide;
    const row = Math.floor(idx / sectorsPerSide);
    const jitterX = (rng() - 0.5) * sectorSize * coverage;
    const jitterY = (rng() - 0.5) * sectorSize * coverage;
    return [col * sectorSize + sectorSize / 2 + jitterX, row * sectorSize + sectorSize / 2 + jitterY];
  });
}

function buildScatter(seed, originX, originY) {
  const rng = mulberry32(seed);
  const shapes = [];

  const bigShapePlan = [
    { kind: 'outlinedTriangle', count: 1, sizeMin: 3, sizeMax: 5.5 },
    { kind: 'filledTriangle', count: 1, sizeMin: 2.5, sizeMax: 4.5 },
    { kind: 'dot', count: 1, sizeMin: 1, sizeMax: 2.2 },
    { kind: 'cube', count: 1, sizeMin: 4.5, sizeMax: 7 },
  ];

  const totalBigShapes = bigShapePlan.reduce((sum, plan) => sum + plan.count, 0);
  const bigShapePositions = buildSectorPositions(totalBigShapes, rng, 0.85);
  let positionCursor = 0;

  bigShapePlan.forEach((plan) => {
    for (let i = 0; i < plan.count; i += 1) {
      const [rawX, rawY] = bigShapePositions[positionCursor];
      positionCursor += 1;
      const cx = originX + rawX;
      const cy = originY + rawY;
      const size = plan.sizeMin + rng() * (plan.sizeMax - plan.sizeMin);
      const rotation = rng() * Math.PI * 2;

      if (plan.kind === 'outlinedTriangle') {
        shapes.push(outlinedTriangle(cx, cy, size, rotation));
      } else if (plan.kind === 'filledTriangle') {
        shapes.push(filledTriangle(cx, cy, size, rotation));
      } else if (plan.kind === 'dot') {
        shapes.push(dot(cx, cy, size));
      } else if (plan.kind === 'cube') {
        shapes.push(isometricCube(cx, cy, size));
      }
    }
  });

  const speckCount = 4;
  const speckPositions = buildSectorPositions(speckCount, rng, 0.9);
  for (let i = 0; i < speckCount; i += 1) {
    const [rawX, rawY] = speckPositions[i];
    const cx = originX + rawX;
    const cy = originY + rawY;
    const size = 0.5 + rng() * 0.9;
    const rotation = rng() * Math.PI * 2;
    shapes.push(inkSpeck(cx, cy, size, rotation, rng));
  }

  return shapes;
}

function buildSuperScatter() {
  const shapes = [];
  for (let qy = 0; qy < SUPER_GRID; qy += 1) {
    for (let qx = 0; qx < SUPER_GRID; qx += 1) {
      const seed = SEED + (qy * SUPER_GRID + qx) * 9973;
      shapes.push(...buildScatter(seed, qx * TILE, qy * TILE));
    }
  }
  return shapes;
}

function ShapeElement({ shape }) {
  if (shape.type === 'circle') {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
  }
  if (shape.type === 'cube') {
    return (
      <g>
        {shape.faces.map((d, i) => (
          <path key={i} d={d} fill={INK} stroke={INK} strokeWidth="0.25" />
        ))}
        {shape.facetLines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#fff" strokeWidth="0.4" opacity="0.55" />
        ))}
        <circle
          cx={shape.rivet[0]}
          cy={shape.rivet[1]}
          r={shape.rivet[2]}
          fill="#fff"
          stroke={INK}
          strokeWidth="0.4"
        />
      </g>
    );
  }
  return (
    <path
      d={shape.d}
      fill={shape.fill}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      strokeLinejoin="round"
    />
  );
}

export function ScatterGridBackground() {
  const gridLines = buildGridLines();
  const scatter = buildSuperScatter();
  const { x, y, zoom } = useViewport();

  return (
    <svg className="scatter-grid-background" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern
          id="scatter-grid-pattern"
          width={SUPER_TILE}
          height={SUPER_TILE}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${x} ${y}) scale(${zoom})`}
        >
          <rect width={SUPER_TILE} height={SUPER_TILE} fill="#fff" />
          <g stroke={INK} strokeWidth="1.3">
            {gridLines.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          <g>
            {scatter.map((shape, i) => (
              <ShapeElement key={i} shape={shape} />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#scatter-grid-pattern)" />
    </svg>
  );
}
