import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { IconPlus, IconTerminal } from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";

export function ContextSidebar() {
  const open = useUiStore((state) => state.contextSidebarOpen);
  const workspaceView = useUiStore((state) => state.workspaceView);
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore((state) => state.sessions);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectSession = useAppStore((state) => state.selectSession);
  const createSession = useAppStore((state) => state.createSession);
  const addProject = useAppStore((state) => state.addProject);

  if (!open || workspaceView !== "terminal") return null;
  const projectSessions = sessions.filter((session) => session.projectId === currentProjectId);

  return (
    <aside className="context-sidebar" aria-label={t("workspaceContext")}>
      <header className="context-header">
        <span>{t("projects")}</span>
        <button
          className="icon-btn"
          type="button"
          title={t("addProject")}
          aria-label={t("addProject")}
          onClick={async () => {
            const selected = await openDialog({ directory: true, multiple: false });
            if (typeof selected === "string") await addProject(selected);
          }}
        >
          <IconPlus />
        </button>
      </header>
      <div className="context-projects">
        {projects.map((project) => (
          <button
            type="button"
            key={project.id}
            className={`context-row ${project.id === currentProjectId ? "active" : ""}`}
            title={project.path}
            onClick={() => selectProject(project.id)}
          >
            <span className="context-project-mark" style={{ backgroundColor: project.color }} />
            <span className="context-row-label">{project.name}</span>
          </button>
        ))}
      </div>
      <header className="context-header context-session-header">
        <span>{t("sessions")}</span>
        {currentProjectId && (
          <button
            className="icon-btn"
            type="button"
            title={t("newTerminal")}
            aria-label={t("newTerminal")}
            onClick={() => void createSession(currentProjectId)}
          >
            <IconPlus />
          </button>
        )}
      </header>
      <div className="context-sessions">
        {projectSessions.map((session) => (
          <button
            type="button"
            key={session.id}
            className={`context-row ${session.id === currentSessionId ? "active" : ""}`}
            onClick={() => selectSession(session.id)}
          >
            <IconTerminal size={13} />
            <span className="context-row-label">{session.title}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
