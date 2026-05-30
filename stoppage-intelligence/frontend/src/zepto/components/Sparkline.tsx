interface Props {
  values: number[];
  forecast?: { values: number[]; upper: number[]; lower: number[] };
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  outlierIdx?: number[];
  ariaLabel?: string;
}

export function Sparkline({
  values, forecast, width = 140, height = 36,
  stroke = "#1a2330", fill = "rgba(26, 35, 48, 0.06)",
  outlierIdx = [], ariaLabel,
}: Props) {
  if (values.length === 0) return <svg className="z-sparkline" width={width} height={height} />;

  const allVals = [...values, ...(forecast?.upper ?? []), ...(forecast?.lower ?? [])];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = Math.max(1, max - min);

  const totalCols = values.length + (forecast?.values.length ?? 0);
  const stepX = width / Math.max(1, totalCols - 1);

  const px = (i: number) => i * stepX;
  const py = (v: number) => height - ((v - min) / range) * (height - 6) - 3;

  const points = values.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const area = `M ${px(0)},${height} L ${points
    .split(" ")
    .map(p => p)
    .join(" L ")} L ${px(values.length - 1)},${height} Z`;

  // Forecast extension
  let forecastPath = "";
  let upperPath = "";
  let lowerPath = "";
  if (forecast) {
    const lastIdx = values.length - 1;
    const fwdValues = forecast.values;
    const fwdPoints = fwdValues.map((v, i) => `${px(lastIdx + 1 + i)},${py(v)}`);
    forecastPath = `M ${px(lastIdx)},${py(values[lastIdx])} L ${fwdPoints.join(" L ")}`;

    // Confidence band polygon
    const upperPts = forecast.upper.map((v, i) => `${px(lastIdx + 1 + i)},${py(v)}`);
    const lowerPts = [...forecast.lower].reverse().map((v, i) => {
      const idx = forecast.lower.length - 1 - i;
      return `${px(lastIdx + 1 + idx)},${py(v)}`;
    });
    upperPath = `M ${px(lastIdx)},${py(values[lastIdx])} L ${upperPts.join(" L ")} L ${lowerPts.join(" L ")} Z`;
  }

  return (
    <svg className="z-sparkline" width={width} height={height} aria-label={ariaLabel} role="img">
      <path d={area} fill={fill} />
      <polyline points={points} stroke={stroke} strokeWidth={1.5} fill="none" />
      {outlierIdx.map(i => (
        <circle key={i} cx={px(i)} cy={py(values[i])} r={2.5} fill="#d92d20" stroke="#fff" strokeWidth={1} />
      ))}
      {forecast && (
        <>
          <path d={upperPath} fill="rgba(255, 190, 7, 0.18)" />
          <path d={forecastPath} stroke="#FFBE07" strokeWidth={1.5} fill="none" strokeDasharray="3 3" />
        </>
      )}
    </svg>
  );
}
