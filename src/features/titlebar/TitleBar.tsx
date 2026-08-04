// Custom draggable titlebar with native window buttons (spec §5.7, §6).
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  IconAgent,
  IconBell,
  IconGit,
  IconHistory,
  IconMaximize,
  IconMinimize,
  IconRestore,
  IconSettings,
  IconSidebar,
  IconClose,
} from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore, type RightPanelTab } from "../../shared/stores/uiStore";

const appWindow = getCurrentWindow();

const PANEL_TOOLS: Array<{
  id: RightPanelTab;
  labelKey: string;
  Icon: typeof IconAgent;
  tip: string;
}> = [
  { id: "agent", labelKey: "agent", Icon: IconAgent, tip: "Ctrl+Shift+A" },
  { id: "git", labelKey: "git", Icon: IconGit, tip: "Ctrl+Shift+G" },
  { id: "history", labelKey: "history", Icon: IconHistory, tip: "" },
  { id: "notifications", labelKey: "notifications", Icon: IconBell, tip: "Ctrl+Shift+N" },
];

export function TitleBar() {
  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === s.currentProjectId),
  );
  const unread = useAppStore((s) => s.unreadCount);
  const contextSidebarOpen = useUiStore((s) => s.contextSidebarOpen);
  const workspaceView = useUiStore((s) => s.workspaceView);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const toggleWorkspaceContext = useUiStore((s) => s.toggleWorkspaceContext);
  const setWorkspaceView = useUiStore((s) => s.setWorkspaceView);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const openSettings = useUiStore((s) => s.openSettings);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let un: (() => void) | undefined;
    const refreshMaximized = () => {
      void appWindow.isMaximized().then(
        (value) => {
          if (!cancelled) setMaximized(value);
        },
        (error) => {
          console.error("Failed to query maximized window state", error);
        },
      );
    };
    refreshMaximized();
    void appWindow
      .onResized(refreshMaximized)
      .then(
        (u) => {
          if (cancelled) {
            u();
            return;
          }
          un = u;
        },
        (error) => {
          console.error("Failed to register window resize listener", error);
        },
      );
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  const onDoubleClick = useCallback(() => {
    void appWindow.toggleMaximize();
  }, []);

  return (
    <div className="titlebar">
      <div
        className="drag-region"
        data-tauri-drag-region
        onDoubleClick={onDoubleClick}
        onMouseDown={(e) => {
          if (e.buttons === 1 && e.detail === 1) void appWindow.startDragging();
        }}
      >
        <img
          className="icon-logo"
          src="./brand/galaxy-mark.svg"
          alt=""
          width={18}
          height={18}
          draggable={false}
        />
        <span className="app-name">{t("appName")}</span>
        {project && (
          <span className="current-project" title={project.path}>
            <span className="project-sep" aria-hidden="true">
              /
            </span>
            <span>{project.name}</span>
          </span>
        )}
      </div>

      <div className="workspace-switcher" role="tablist" aria-label={t("workspaceView")}>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceView === "terminal"}
          className={workspaceView === "terminal" ? "active" : ""}
          onClick={() => setWorkspaceView("terminal")}
        >
          {t("terminal")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceView === "insights"}
          className={workspaceView === "insights" ? "active" : ""}
          onClick={() => setWorkspaceView("insights")}
        >
          {t("insights")}
        </button>
      </div>

      <div className="titlebar-tools" role="toolbar" aria-label={t("rightPanel")}>
        <button
          type="button"
          className={`icon-btn titlebar-tool ${workspaceView === "terminal" && contextSidebarOpen ? "active" : ""}`}
          title={t("toggleSidebar")}
          aria-label={t("toggleSidebar")}
          aria-pressed={workspaceView === "terminal" && contextSidebarOpen}
          onClick={toggleWorkspaceContext}
        >
          <IconSidebar />
        </button>
        <span className="titlebar-tools-sep" aria-hidden="true" />
        {PANEL_TOOLS.map((tb) => {
          const active = rightPanelOpen && rightPanelTab === tb.id;
          return (
            <button
              key={tb.id}
              type="button"
              className={`icon-btn titlebar-tool ${active ? "active" : ""}`}
              title={`${t(tb.labelKey)}${tb.tip ? ` · ${tb.tip}` : ""}`}
              aria-label={t(tb.labelKey)}
              aria-pressed={active}
              onClick={() => togglePanel(tb.id)}
            >
              <tb.Icon />
              {tb.id === "notifications" && unread > 0 && (
                <span className="titlebar-tool-badge">{unread > 9 ? "9+" : unread}</span>
              )}
            </button>
          );
        })}
        <span className="titlebar-tools-sep" aria-hidden="true" />
        <button
          type="button"
          className="icon-btn titlebar-tool titlebar-settings"
          title={`${t("settings")} · Ctrl+,`}
          aria-label={t("settings")}
          onClick={() => openSettings("general")}
        >
          <IconSettings />
          <span className="titlebar-settings-label">{t("settings")}</span>
        </button>
      </div>

      <div className="window-controls">
        <button type="button" aria-label="最小化" onClick={() => void appWindow.minimize()}>
          <IconMinimize />
        </button>
        <button
          type="button"
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => void appWindow.toggleMaximize()}
        >
          {maximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button
          type="button"
          aria-label="关闭"
          className="close"
          onClick={() => void appWindow.close()}
        >
          <IconClose size={12} />
        </button>
      </div>
    </div>
  );
}
