import { useMemo, useState, type CSSProperties } from "react";

import type { ProjectInsight } from "../../shared/ipc/types";
import { t } from "../../shared/i18n";

type SortKey = "commands" | "duration" | "failures";

export function ProjectRanking({
  projects,
  onSelect,
}: {
  projects: ProjectInsight[];
  onSelect: (projectId: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>("commands");
  const rows = useMemo(() => [...projects].sort((left, right) => {
    if (sort === "duration") return right.activeDurationMs - left.activeDurationMs;
    if (sort === "failures") return (right.failureRate ?? -1) - (left.failureRate ?? -1);
    return right.commandCount - left.commandCount;
  }), [projects, sort]);
  const max = Math.max(1, ...rows.map((project) => metric(project, sort)));

  return (
    <section className="insights-region ranking-region" aria-labelledby="project-ranking-title">
      <header className="insights-region-header">
        <h2 id="project-ranking-title">{t("insightsProjectRanking")}</h2>
        <div className="compact-segments" aria-label={t("insightsRankingMode")}>
          {(["commands", "duration", "failures"] as const).map((key) => (
            <button key={key} type="button" className={sort === key ? "active" : ""} onClick={() => setSort(key)}>
              {key === "commands" ? t("insightsCommands") : key === "duration" ? t("insightsDuration") : t("insightsFailureRate")}
            </button>
          ))}
        </div>
      </header>
      <div className="ranking-list">
        {rows.map((project, index) => (
          <button className="ranking-row" type="button" key={project.projectId} onClick={() => onSelect(project.projectId)}>
            <span className="ranking-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="ranking-name">{project.projectName}</span>
            <span className="ranking-measure" style={{ "--measure": metric(project, sort) / max } as CSSProperties} />
            <strong>{formatMetric(project, sort)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function metric(project: ProjectInsight, sort: SortKey) {
  if (sort === "duration") return project.activeDurationMs;
  if (sort === "failures") return project.failureRate ?? 0;
  return project.commandCount;
}

function formatMetric(project: ProjectInsight, sort: SortKey) {
  if (sort === "duration") return formatDuration(project.activeDurationMs);
  if (sort === "failures") return project.failureRate == null ? t("insightsNoResult") : `${Math.round(project.failureRate * 100)}%`;
  return String(project.commandCount);
}

function formatDuration(ms: number) {
  const hours = ms / 3_600_000;
  return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(ms / 60_000)}m`;
}
