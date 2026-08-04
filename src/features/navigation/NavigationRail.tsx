import { IconHistory, IconLogo, IconSettings, IconTerminal } from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useUiStore } from "../../shared/stores/uiStore";

type RailAction = {
  id: string;
  label: string;
  icon: typeof IconTerminal;
  active: boolean;
  dialog?: boolean;
  onClick: () => void;
};

export function NavigationRail() {
  const workspaceView = useUiStore((state) => state.workspaceView);
  const setWorkspaceView = useUiStore((state) => state.setWorkspaceView);
  const historySearchOpen = useUiStore((state) => state.historySearchOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const openHistorySearch = useUiStore((state) => state.openHistorySearch);
  const openSettings = useUiStore((state) => state.openSettings);

  const actions: RailAction[] = [
    {
      id: "terminal",
      label: t("terminal"),
      icon: IconTerminal,
      active: workspaceView === "terminal",
      onClick: () => setWorkspaceView("terminal"),
    },
    {
      id: "insights",
      label: t("insights"),
      icon: IconInsights,
      active: workspaceView === "insights",
      onClick: () => setWorkspaceView("insights"),
    },
    {
      id: "history",
      label: t("history"),
      icon: IconHistory,
      active: historySearchOpen,
      dialog: true,
      onClick: () => {
        setWorkspaceView("terminal");
        openHistorySearch();
      },
    },
  ];

  return (
    <nav className="navigation-rail" aria-label={t("primaryNavigation")}>
      <div className="rail-brand" aria-label={t("appName")}>
        <IconLogo size={22} />
      </div>
      <div className="rail-actions">
        {actions.map(({ id, label, icon: Icon, active, dialog, onClick }) => (
          <button
            key={id}
            type="button"
            className={`rail-button ${active ? "active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={dialog ? undefined : active}
            aria-haspopup={dialog ? "dialog" : undefined}
            aria-expanded={dialog ? active : undefined}
            onClick={onClick}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`rail-button rail-settings ${settingsOpen ? "active" : ""}`}
        title={t("settings")}
        aria-label={t("settings")}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => openSettings("general")}
      >
        <IconSettings size={16} />
      </button>
    </nav>
  );
}

function IconInsights({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="pixel-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M2.5 12.5h11M3.5 10V7.5M6.5 10V4.5M9.5 10V6M12.5 10V2.5" />
    </svg>
  );
}
