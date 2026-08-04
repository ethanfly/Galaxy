import type { DailyActivity } from "../../shared/ipc/types";
import { t } from "../../shared/i18n";

export function ActivityTrend({ daily }: { daily: DailyActivity[] }) {
  const width = 720;
  const height = 180;
  const padding = 12;
  const max = Math.max(1, ...daily.map((day) => day.commandCount));
  const points = daily.map((day, index) => ({
    day,
    x: padding + (index / Math.max(1, daily.length - 1)) * (width - padding * 2),
    y: height - padding - (day.commandCount / max) * (height - padding * 2),
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const total = daily.reduce((sum, day) => sum + day.commandCount, 0);
  const failures = daily.reduce((sum, day) => sum + day.failureCount, 0);

  return (
    <section className="insights-region trend-region" aria-labelledby="activity-trend-title">
      <header className="insights-region-header">
        <div>
          <h2 id="activity-trend-title">{t("insightsTrend")}</h2>
          <p>当前范围 {total} 条命令，{failures} 次失败</p>
        </div>
      </header>
      <div className="trend-chart-wrap">
        <svg
          className="trend-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`命令活动趋势，共 ${total} 条命令`}
          preserveAspectRatio="none"
        >
          <path className="trend-baseline" d={`M${padding},${height - padding}H${width - padding}`} />
          <path className="trend-line" d={path} />
          {points.filter((_, index) => index % Math.max(1, Math.ceil(points.length / 12)) === 0).map(({ day, x, y }) => (
            <circle key={day.date} cx={x} cy={y} r="2.5">
              <title>{day.date}：{day.commandCount} 条命令</title>
            </circle>
          ))}
        </svg>
      </div>
    </section>
  );
}
