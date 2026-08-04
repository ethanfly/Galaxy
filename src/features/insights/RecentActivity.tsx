import { useState } from "react";

import { blockRerun, blockSetFavorite } from "../../shared/ipc/client";
import { t } from "../../shared/i18n";
import type { RecentActivity as RecentActivityItem } from "../../shared/ipc/types";
import { IconPlay, IconStar, IconTerminal } from "../../shared/icons/Icons";
import { formatDateTime, truncate } from "../../shared/utils";

export function RecentActivity({
  items,
  livePaneIds,
  onOpen,
  onChanged,
}: {
  items: RecentActivityItem[];
  livePaneIds: Set<string>;
  onOpen: (item: RecentActivityItem) => void;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <section className="insights-region recent-region" aria-labelledby="recent-activity-title">
      <header className="insights-region-header">
        <h2 id="recent-activity-title">{t("insightsRecent")}</h2>
        <span>{items.length} 条记录</span>
      </header>
      <div className="recent-list">
        {items.map((item) => (
          <div className="recent-row" key={item.id}>
            <span className={`result-mark ${item.exitCode == null ? "unknown" : item.exitCode === 0 ? "success" : "failure"}`} />
            <button className="recent-command" type="button" title={item.command} onClick={() => onOpen(item)}>
              <code>{truncate(item.command || "未捕获命令", 96)}</code>
              <span>{item.projectName} · {formatDateTime(item.startedAt)}</span>
            </button>
            <span className="recent-duration">{formatDuration(item.durationMs)}</span>
            <div className="recent-actions">
              <button type="button" className="icon-btn" title={t("insightsOpenSession")} aria-label={t("insightsOpenSession")} onClick={() => onOpen(item)}>
                <IconTerminal />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={copied === item.id ? t("insightsCopied") : t("copyCommand")}
                aria-label={copied === item.id ? t("insightsCopied") : t("copyCommand")}
                onClick={async () => {
                  await navigator.clipboard.writeText(item.command);
                  setCopied(item.id);
                }}
              >
                <CopyIcon />
              </button>
              <button
                type="button"
                className={`icon-btn ${item.favorite ? "active" : ""}`}
                title={item.favorite ? t("insightsUnfavorite") : t("favorite")}
                aria-label={item.favorite ? t("insightsUnfavorite") : t("favorite")}
                onClick={async () => {
                  await blockSetFavorite(item.id, !item.favorite);
                  onChanged();
                }}
              >
                <IconStar />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!livePaneIds.has(item.paneId) || !item.command}
                title={t("insightsRerun")}
                aria-label={t("insightsRerun")}
                onClick={() => void blockRerun(item.id, item.paneId)}
              >
                <IconPlay />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDuration(ms: number | null) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function CopyIcon() {
  return (
    <svg className="pixel-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" /><path d="M2.5 9.5h-1v-7h7v1" />
    </svg>
  );
}
