import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function FlickeringGrid({
  squareSize = 4,
  gridGap = 6,
  flickerChance = 0.3,
  color = 'rgb(0, 0, 0)',
  width,
  height,
  className,
  maxOpacity = 0.3,
  maxFps = 12,
  squareRadius = 0,
  ...props
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isInView, setIsInView] = useState(false);
  const [isFocused, setIsFocused] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const isActive = isInView && isFocused;

  const memoizedColor = useMemo(() => {
    const toRGBA = (colorValue) => {
      if (typeof window === 'undefined') {
        return `rgba(0, 0, 0,`;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'rgba(255, 0, 0,';
      ctx.fillStyle = colorValue;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      return `rgba(${r}, ${g}, ${b},`;
    };
    return toRGBA(color);
  }, [color]);

  const setupCanvas = useCallback(
    (canvas, canvasWidth, canvasHeight) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      const cols = Math.ceil(canvasWidth / (squareSize + gridGap));
      const rows = Math.ceil(canvasHeight / (squareSize + gridGap));

      const squares = new Float32Array(cols * rows);
      for (let i = 0; i < squares.length; i++) {
        squares[i] = Math.random() * maxOpacity;
      }

      return { cols, rows, squares, dpr };
    },
    [squareSize, gridGap, maxOpacity],
  );

  const updateSquares = useCallback(
    (squares, deltaTime) => {
      let changed = false;
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() < flickerChance * deltaTime) {
          squares[i] = Math.random() * maxOpacity;
          changed = true;
        }
      }
      return changed;
    },
    [flickerChance, maxOpacity],
  );

  const drawGrid = useCallback(
    (ctx, canvasWidth, canvasHeight, cols, rows, squares, dpr) => {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.fillStyle = 'transparent';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const radius = Math.min(squareRadius, squareSize / 2) * dpr;
      const drawSquare = radius > 0
        ? (x, y, size) => {
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(x, y, size, size, radius);
            } else {
              ctx.moveTo(x + radius, y);
              ctx.arcTo(x + size, y, x + size, y + size, radius);
              ctx.arcTo(x + size, y + size, x, y + size, radius);
              ctx.arcTo(x, y + size, x, y, radius);
              ctx.arcTo(x, y, x + size, y, radius);
              ctx.closePath();
            }
            ctx.fill();
          }
        : (x, y, size) => ctx.fillRect(x, y, size, size);

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const opacity = squares[i * rows + j];
          ctx.fillStyle = `${memoizedColor}${opacity})`;
          drawSquare(
            i * (squareSize + gridGap) * dpr,
            j * (squareSize + gridGap) * dpr,
            squareSize * dpr,
          );
        }
      }
    },
    [memoizedColor, squareSize, gridGap, squareRadius],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    let animationFrameId = null;
    let resizeObserver = null;
    let intersectionObserver = null;
    let gridParams = null;

    if (canvas && container && ctx) {
      const updateCanvasSize = () => {
        const newWidth = width || container.clientWidth;
        const newHeight = height || container.clientHeight;
        setCanvasSize({ width: newWidth, height: newHeight });
        gridParams = setupCanvas(canvas, newWidth, newHeight);
        drawGrid(
          ctx,
          canvas.width,
          canvas.height,
          gridParams.cols,
          gridParams.rows,
          gridParams.squares,
          gridParams.dpr,
        );
      };

      updateCanvasSize();

      const frameInterval = 1000 / maxFps;
      let lastTime = 0;
      let lastDrawTime = 0;
      const animate = (time) => {
        if (!isActive || !gridParams) return;
        animationFrameId = requestAnimationFrame(animate);

        if (time - lastDrawTime < frameInterval) return;
        const deltaTime = (time - lastTime) / 1000;
        lastTime = time;
        lastDrawTime = time;

        const changed = updateSquares(gridParams.squares, deltaTime);
        if (!changed) return;

        drawGrid(
          ctx,
          canvas.width,
          canvas.height,
          gridParams.cols,
          gridParams.rows,
          gridParams.squares,
          gridParams.dpr,
        );
      };

      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });
      resizeObserver.observe(container);

      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          setIsInView(entry.isIntersecting);
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(canvas);

      if (isActive) {
        animationFrameId = requestAnimationFrame(animate);
      }
    }

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
      }
    };
  }, [setupCanvas, updateSquares, drawGrid, width, height, isActive, maxFps]);

  useEffect(() => {
    const handleVisibilityChange = () => setIsFocused(!document.hidden);
    const handleFocus = () => setIsFocused(!document.hidden);
    const handleBlur = () => setIsFocused(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={['flickering-grid', className].filter(Boolean).join(' ')}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="flickering-grid__canvas"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
        }}
      />
    </div>
  );
}
