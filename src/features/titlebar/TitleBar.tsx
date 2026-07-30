// Custom draggable titlebar with native window buttons (spec §5.7, §6).
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === s.currentProjectId),
  );
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let un: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized);
    void appWindow.onResized(() => {
      void appWindow.isMaximized().then(setMaximized);
    }).then((u) => (un = u));
    return () => un?.();
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
        <img className="icon-logo pixelated" src="./icon.png" alt="" width={16} height={16} />
        <span className="app-name">{t("appName")}</span>
        {project && (
          <span className="current-project" title={project.path}>
            ✦ {project.name}
          </span>
        )}
      </div>
      <div className="window-controls">
        <button aria-label="最小化" onClick={() => void appWindow.minimize()}>
          ─
        </button>
        <button
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => void appWindow.toggleMaximize()}
        >
          {maximized ? "❐" : "□"}
        </button>
        <button aria-label="关闭" className="close" onClick={() => void appWindow.close()}>
          ✕
        </button>
      </div>
    </div>
  );
}
