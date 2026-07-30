// Right multi-function panel: Agent / Git / History / Notifications — flat,
// no nested cards (spec §6).
import { AgentPanel } from "./AgentPanel";
import { GitPanel } from "./GitPanel";
import { HistoryPanel } from "./HistoryPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore, type RightPanelTab } from "../../shared/stores/uiStore";

const TABS: Array<{ id: RightPanelTab; labelKey: string }> = [
  { id: "agent", labelKey: "agent" },
  { id: "git", labelKey: "git" },
  { id: "history", labelKey: "history" },
  { id: "notifications", labelKey: "notifications" },
];

export function RightPanel() {
  const open = useUiStore((s) => s.rightPanelOpen);
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.openPanel);
  const unread = useAppStore((s) => s.unreadCount);

  if (!open) return <div className="right-panel hidden" />;

  return (
    <div className="right-panel" aria-label="多功能面板">
      <div className="panel-tabs" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id}
            className={tab === tb.id ? "active" : ""}
            onClick={() => setTab(tb.id)}
          >
            {t(tb.labelKey)}
            {tb.id === "notifications" && unread > 0 ? ` (${unread})` : ""}
          </button>
        ))}
      </div>
      {tab === "agent" && <AgentPanel />}
      {tab === "git" && <GitPanel />}
      {tab === "history" && <HistoryPanel />}
      {tab === "notifications" && <NotificationsPanel />}
    </div>
  );
}
