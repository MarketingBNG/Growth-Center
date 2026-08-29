/**
 * A ranking line, small enough to sit in a table cell.
 *
 * Hand-drawn SVG rather than a chart library: one of these renders per row, and a
 * ResponsiveContainer per cell would mount hundreds of observers to draw fifty pixels.
 *
 * Server-rendered — it holds no state and takes no interaction, so it stays out of the
 * client bundle entirely.
 */
export function Sparkline({
  values,
  width = 76,
  height = 20,
  /** True where a FALL in the number is an improvement, as with a search position. */
  lowerIsBetter = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  lowerIsBetter?: boolean;
}) {
  // One reading is a dot, not a line, and drawing it as a flat line would claim a
  // stability the data has not shown.
  if (values.length < 2) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has no range to divide by; centre it rather than dividing by zero.
  const span = max - min || 1;

  const step = width / (values.length - 1);
  const y = (v: number) => {
    const t = (v - min) / span;
    // SVG y grows downward, so a smaller position number has to sit higher.
    const fromTop = lowerIsBetter ? t : 1 - t;
    return 1 + fromTop * (height - 2);
  };

  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const better = lowerIsBetter ? last < first : last > first;
  const same = last === first;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Trend from ${first} to ${last}`}
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Colour is never the only signal — the position and change columns beside this
        // carry the same fact in numbers.
        className={same ? 'stroke-muted-foreground' : better ? 'stroke-success' : 'stroke-destructive'}
      />
      <circle
        cx={width}
        cy={y(last)}
        r={1.8}
        className={same ? 'fill-muted-foreground' : better ? 'fill-success' : 'fill-destructive'}
      />
    </svg>
  );
}
