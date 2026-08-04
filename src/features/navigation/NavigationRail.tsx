import {
  IconFolder,
  IconHistory,
  IconLogo,
  IconSessions,
  IconSettings,
  IconTerminal,
} from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useUiStore } from "../../shared/stores/uiStore";

type RailAction = {
  id: string;
  label: string;
  icon: typeof IconTerminal;
  active: boolean;
  onClick: () => void;
};

export function NavigationRail() {
  const workspaceView = useUiStore((state) => state.workspaceView);
  const contextSidebarOpen = useUiStore((state) => state.contextSidebarOpen);
  const setWorkspaceView = useUiStore((state) => state.setWorkspaceView);
  const toggleContextSidebar = useUiStore((state) => state.toggleContextSidebar);
  const openBlockSearch = useUiStore((state) => state.openBlockSearch);
  const openSettings = useUiStore((state) => state.openSettings);

  const actions: RailAction[] = [
    {
      id: "projects",
      label: t("projects"),
      icon: IconFolder,
      active: contextSidebarOpen && workspaceView === "terminal",
      onClick: () => {
        setWorkspaceView("terminal");
        if (!contextSidebarOpen) toggleContextSidebar();
      },
    },
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
      id: "sessions",
      label: t("sessions"),
      icon: IconSessions,
      active: false,
      onClick: () => {
        setWorkspaceView("terminal");
        if (!contextSidebarOpen) toggleContextSidebar();
      },
    },
    {
      id: "favorites",
      label: t("favorites"),
      icon: IconHistory,
      active: false,
      onClick: openBlockSearch,
    },
  ];

  return (
    <nav className="navigation-rail" aria-label={t("primaryNavigation")}>
      <div className="rail-brand" aria-label={t("appName")}>
        <IconLogo size={22} />
      </div>
      <div className="rail-actions">
        {actions.map(({ id, label, icon: Icon, active, onClick }) => (
          <button
            key={id}
            type="button"
            className={`rail-button ${active ? "active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="rail-button rail-settings"
        title={t("settings")}
        aria-label={t("settings")}
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
