// Notification center in the statusbar-facing panel (§5.4, §5.6).
import { appRelaunch, notificationMarkRead } from "../../shared/ipc/client";
import type { NotificationItem } from "../../shared/ipc/types";
import { useAppStore } from "../../shared/stores/appStore";
import { layoutPanes, formatDateTime } from "../../shared/utils";
import { t } from "../../shared/i18n";

export function NotificationsPanel() {
  const notifications = useAppStore((s) => s.notifications);
  const refresh = useAppStore((s) => s.refreshNotifications);

  const jumpToPane = (n: NotificationItem) => {
    const app = useAppStore.getState();
    const session = app.sessions.find((s) => layoutPanes(s.layout).some((p) => p.id === n.paneId));
    if (session) app.selectSession(session.id);
  };

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <span style={{ flex: 1, color: "var(--text-lo)", fontSize: "var(--fs-body-small)" }}>
          {notifications.filter((n) => !n.read).length} 条未读
        </span>
        <button
          className="btn"
          onClick={() => {
            void notificationMarkRead().then(() => refresh());
          }}
        >
          {t("markAllRead")}
        </button>
      </div>
      {notifications.length === 0 && <Empty text={t("noNotifications")} />}
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`notif-item ${n.read ? "" : "unread"}`}
          onClick={() => {
            if (!n.read) void notificationMarkRead([n.id]).then(() => refresh());
            if (n.paneId) jumpToPane(n);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && jumpToPane(n)}
        >
          <div className="notif-title">{n.title}</div>
          <div className="notif-body">{n.body}</div>
          <div className="notif-time">{formatDateTime(n.at)}</div>
          {n.action === "app.relaunch" && (
            <button
              type="button"
              className="btn primary"
              style={{ marginTop: 8 }}
              onClick={(e) => {
                e.stopPropagation();
                void appRelaunch();
              }}
            >
              {t("restartNow")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "var(--text-lo)", textAlign: "center" }}>{text}</div>;
}
