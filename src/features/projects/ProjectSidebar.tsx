// Project sidebar with agent badges (spec §5.1).
import { open } from "@tauri-apps/plugin-dialog";

import { AgentBadge } from "../terminal/AgentBadge";
import { ContextMenu } from "../tabs/TabBar";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { layoutPanes } from "../../shared/utils";
import { useState } from "react";

export function ProjectSidebar() {
  const sidebarOpen = useSidebar();
  const projects = useAppStore((s) => s.projects);
  const sessions = useAppStore((s) => s.sessions);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const createSession = useAppStore((s) => s.createSession);
  const removeProject = useAppStore((s) => s.removeProject);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  if (!sidebarOpen) return <div className="sidebar collapsed" />;

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      const app = useAppStore.getState();
      await app.addProject(selected);
    }
  };

  return (
    <div className="sidebar starfield" aria-label={t("projects")}>
      <div className="sidebar-header">
        <span>{t("projects")}</span>
        <button
          className="icon-btn"
          title={t("addProject")}
          onClick={() => void pickFolder()}
        >
          ＋
        </button>
      </div>
      <div className="project-list">
        {projects.length === 0 && (
          <div style={{ padding: 12, color: "var(--text-lo)", fontSize: 12 }}>
            尚无项目，点击 ＋ 添加目录
          </div>
        )}
        {projects.map((p) => {
          const pSessions = sessions.filter((s) => s.projectId === p.id);
          const agents = new Set(
            pSessions.flatMap((s) => layoutPanes(s.layout).map((pn) => pn.agentKind)).filter(Boolean),
          );
          return (
            <div
              key={p.id}
              className={`project-item ${p.id === currentProjectId ? "active" : ""}`}
              onClick={() => selectProject(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: p.id, x: e.clientX, y: e.clientY });
              }}
              title={p.path}
            >
              <span className="project-dot" style={{ background: p.color }} />
              <span className="project-name">{p.name}</span>
              {[...agents].map((a) => (
                <AgentBadge key={a} kind={a!} />
              ))}
              <span className="project-actions">
                <button
                  className="icon-btn"
                  title={t("newTerminal")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void createSession(p.id);
                  }}
                >
                  ⌁
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t("newTerminal"),
              onClick: () => void createSession(menu.id),
            },
            {
              label: t("delete"),
              danger: true,
              onClick: () => void removeProject(menu.id),
            },
          ]}
        />
      )}
    </div>
  );
}

import { useUiStore } from "../../shared/stores/uiStore";
function useSidebar() {
  return useUiStore((s) => s.sidebarOpen);
}
