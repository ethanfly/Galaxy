import { useMemo, useRef, useState } from "react";

import type { DailyActivity } from "../../shared/ipc/types";
import { t } from "../../shared/i18n";

export function ActivityHeatmap({ daily }: { daily: DailyActivity[] }) {
  const [hovered, setHovered] = useState<DailyActivity | null>(null);
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const monthLabels = useMemo(() => buildMonthLabels(daily), [daily]);

  const moveFocus = (index: number, delta: number) => {
    const next = Math.max(0, Math.min(daily.length - 1, index + delta));
    cells.current[next]?.focus();
  };

  return (
    <section className="insights-region heatmap-region" aria-labelledby="activity-heatmap-title">
      <header className="insights-region-header">
        <div>
          <h2 id="activity-heatmap-title">{t("insightsHeatmap")}</h2>
          <p>{daily[0]?.date ?? ""} 至 {daily[daily.length - 1]?.date ?? ""}</p>
        </div>
        <div className="heatmap-legend" aria-label="活动强度">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`activity-cell activity-level-${level}`} />
          ))}
          <span>多</span>
        </div>
      </header>
      <div className="activity-heatmap-scroll">
        <div className="heatmap-months" aria-hidden="true">
          {monthLabels.map((label) => (
            <span key={`${label.month}-${label.column}`} style={{ gridColumn: label.column }}>
              {label.month}
            </span>
          ))}
        </div>
        <div className="activity-heatmap" role="grid" aria-label="每日命令活动">
          {daily.map((day, index) => (
            <button
              key={day.date}
              ref={(node) => { cells.current[index] = node; }}
              type="button"
              role="gridcell"
              className={`activity-cell activity-level-${day.level}`}
              aria-label={`${day.date}，${day.commandCount} 条命令，${day.successCount} 成功，${day.failureCount} 失败`}
              tabIndex={index === daily.length - 1 ? 0 : -1}
              onMouseEnter={() => setHovered(day)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(day)}
              onBlur={() => setHovered(null)}
              onKeyDown={(event) => {
                const deltas: Record<string, number> = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                };
                const delta = deltas[event.key];
                if (delta == null) return;
                event.preventDefault();
                moveFocus(index, delta);
              }}
            />
          ))}
        </div>
      </div>
      {hovered && (
        <div className="heatmap-tooltip" role="tooltip">
          <strong>{hovered.date}</strong>
          <span>{hovered.commandCount} 条命令</span>
          <span>{hovered.successCount} 成功 · {hovered.failureCount} 失败</span>
          <span>{formatDuration(hovered.activeDurationMs)}</span>
        </div>
      )}
    </section>
  );
}

function buildMonthLabels(daily: DailyActivity[]) {
  const labels: Array<{ month: string; column: number }> = [];
  let previous = "";
  daily.forEach((day, index) => {
    const month = day.date.slice(0, 7);
    if (month !== previous) {
      labels.push({ month: `${Number(month.slice(5))}月`, column: Math.floor(index / 7) + 1 });
      previous = month;
    }
  });
  return labels;
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1000)} 秒`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}
