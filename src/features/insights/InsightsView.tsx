import { useMemo, useState } from "react";

import type { InsightsRange, RecentActivity as RecentActivityItem } from "../../shared/ipc/types";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutPanes } from "../../shared/utils";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { ActivityTrend } from "./ActivityTrend";
import { AgentDistribution } from "./AgentDistribution";
import { ProjectRanking } from "./ProjectRanking";
import { RecentActivity } from "./RecentActivity";
import { useInsights } from "./useInsights";

const RANGES: Array<{ id: InsightsRange; label: string }> = [
  { id: "sevenDays", label: "7 天" },
  { id: "thirtyDays", label: "30 天" },
  { id: "ninetyDays", label: "90 天" },
  { id: "year", label: t("insightsYear") },
];

export function InsightsView() {
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore((state) => state.sessions);
  const selectSession = useAppStore((state) => state.selectSession);
  const setWorkspaceView = useUiStore((state) => state.setWorkspaceView);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [range, setRange] = useState<InsightsRange>("year");
  const { data, loading, refreshing, error, refresh } = useInsights({ projectId, range });
  const livePaneIds = useMemo(() => new Set(
    sessions.flatMap((session) => layoutPanes(session.layout).filter((pane) => pane.exitCode == null).map((pane) => pane.id)),
  ), [sessions]);

  const openActivity = (item: RecentActivityItem) => {
    if (sessions.some((session) => session.id === item.sessionId)) selectSession(item.sessionId);
    setWorkspaceView("terminal");
  };

  return (
    <div className="insights-view">
      <header className="insights-header">
        <div className="insights-title-block">
          <h1>{t("insightsTitle")}</h1>
          <p>{t("insightsPrivacy")}</p>
        </div>
        <div className="insights-filters">
          <label>
            <span>{t("insightsProject")}</span>
            <select value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value || null)}>
              <option value="">{t("insightsAllProjects")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <div className="range-control" role="group" aria-label={t("insightsRange")}>
            {RANGES.map((option) => (
              <button key={option.id} type="button" className={range === option.id ? "active" : ""} onClick={() => setRange(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {data && data.summary.commandCount > 0 && (
          <dl className="insights-metrics">
            <Metric label={t("insightsCommands")} value={String(data.summary.commandCount)} />
            <Metric label={t("insightsActiveDays")} value={String(data.summary.activeDays)} />
            <Metric label={t("insightsSuccessRate")} value={data.summary.successRate == null ? "--" : `${Math.round(data.summary.successRate * 100)}%`} />
            <Metric label={t("insightsActiveTime")} value={formatDuration(data.summary.activeDurationMs)} />
          </dl>
        )}
      </header>

      {loading && <LoadingState />}
      {!loading && error && !data && (
        <div className="insights-message error-state" role="alert">
          <strong>{t("insightsLoadError")}</strong>
          <span>{error}</span>
          <button className="btn" type="button" onClick={() => void refresh()}>{t("insightsReload")}</button>
        </div>
      )}
      {!loading && data && data.summary.commandCount === 0 && (
        <div className="insights-message empty-state">
          <strong>{t("insightsEmptyTitle")}</strong>
          <span>{t("insightsEmptyBody")}</span>
          <button className="btn" type="button" onClick={() => setWorkspaceView("terminal")}>{t("insightsBackTerminal")}</button>
        </div>
      )}
      {data && data.summary.commandCount > 0 && (
        <div className="insights-canvas" aria-busy={refreshing}>
          {refreshing && <span className="refresh-indicator">{t("insightsRefreshing")}</span>}
          {data.invalidRecordCount > 0 && (
            <div className="data-warning">有 {data.invalidRecordCount} 条旧记录时间无效，已从统计中跳过。</div>
          )}
          <ActivityHeatmap daily={data.daily} />
          <ActivityTrend daily={data.daily} />
          <ProjectRanking projects={data.projects} onSelect={setProjectId} />
          <AgentDistribution agents={data.agents} />
          <RecentActivity items={data.recent} livePaneIds={livePaneIds} onOpen={openActivity} onChanged={() => void refresh()} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function LoadingState() {
  return <div className="insights-loading" aria-label={t("insightsLoading")}><i /><i /><i /></div>;
}

function formatDuration(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
