// Right multi-function panel: Agent / Git / History / Notifications — flat,
// no nested cards (spec §6). Opened only via titlebar tools / shortcuts.
import { IconClose } from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore, type RightPanelTab } from "../../shared/stores/uiStore";
import { AgentPanel } from "./AgentPanel";
import { GitPanel } from "./GitPanel";
import { HistoryPanel } from "./HistoryPanel";
import { NotificationsPanel } from "./NotificationsPanel";

const TABS: Array<{ id: RightPanelTab; labelKey: string; tip: string }> = [
  { id: "agent", labelKey: "agent", tip: "Ctrl+Shift+A" },
  { id: "git", labelKey: "git", tip: "Ctrl+Shift+G" },
  { id: "history", labelKey: "history", tip: "" },
  { id: "notifications", labelKey: "notifications", tip: "Ctrl+Shift+N" },
];

export function RightPanel() {
  const open = useUiStore((s) => s.rightPanelOpen);
  const tab = useUiStore((s) => s.rightPanelTab);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const closePanel = useUiStore((s) => s.closePanel);
  const unread = useAppStore((s) => s.unreadCount);

  // Closed: render nothing so the grid column collapses. Entry points are
  // titlebar tools (and shortcuts / statusbar 🔔) only — no side rail.
  if (!open) return null;

  return (
    <div className="right-panel" aria-label={t("rightPanel")}>
      <div className="panel-tabs" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            className={tab === tb.id ? "active" : ""}
            title={tb.tip || undefined}
            onClick={() => togglePanel(tb.id)}
          >
            {t(tb.labelKey)}
            {tb.id === "notifications" && unread > 0 ? ` (${unread})` : ""}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn panel-close"
          title={t("close")}
          aria-label={t("close")}
          onClick={() => closePanel()}
        >
          <IconClose />
        </button>
      </div>
      {tab === "agent" && <AgentPanel />}
      {tab === "git" && <GitPanel />}
      {tab === "history" && <HistoryPanel />}
      {tab === "notifications" && <NotificationsPanel />}
    </div>
  );
}
