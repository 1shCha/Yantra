import { useEffect, useRef, useState } from 'react';
import { useViewport } from '@xyflow/react';

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;

  const h00 = hash(x0, y0);
  const h10 = hash(x0 + 1, y0);
  const h01 = hash(x0, y0 + 1);
  const h11 = hash(x0 + 1, y0 + 1);

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
}

export function HalftoneGrid({
  gridSize = 24,
  noiseScale = 0.12,
  minRadius = 0.4,
  maxRadius = 3.2,
  color = 'rgb(43, 43, 43)',
  maxOpacity = 0.5,
  className,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const { x, y, zoom } = useViewport();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateSize = () => {
      setCanvasSize({ width: container.clientWidth, height: container.clientHeight });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvasSize.width === 0 || canvasSize.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, x * dpr, y * dpr);

    const flowLeft = -x / zoom;
    const flowTop = -y / zoom;
    const flowRight = (canvasSize.width - x) / zoom;
    const flowBottom = (canvasSize.height - y) / zoom;

    const colStart = Math.floor(flowLeft / gridSize) - 1;
    const colEnd = Math.ceil(flowRight / gridSize) + 1;
    const rowStart = Math.floor(flowTop / gridSize) - 1;
    const rowEnd = Math.ceil(flowBottom / gridSize) + 1;

    ctx.fillStyle = color;

    for (let col = colStart; col <= colEnd; col++) {
      for (let row = rowStart; row <= rowEnd; row++) {
        const noiseValue = smoothNoise(col * noiseScale, row * noiseScale);
        const radius = minRadius + (maxRadius - minRadius) * noiseValue;
        const opacity = maxOpacity * (0.3 + 0.7 * noiseValue);
        const cx = col * gridSize + gridSize / 2;
        const cy = row * gridSize + gridSize / 2;

        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }, [canvasSize, x, y, zoom, gridSize, noiseScale, minRadius, maxRadius, color, maxOpacity]);

  return (
    <div
      ref={containerRef}
      className={['halftone-grid', className].filter(Boolean).join(' ')}
    >
      <canvas ref={canvasRef} className="halftone-grid__canvas" />
    </div>
  );
}
