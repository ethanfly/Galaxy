// Shared session chrome helpers so the tab strip and context sidebar stay in sync.
import type { AgentKind, AgentStatus, Session } from "./ipc/types";
import { t } from "./i18n";
import { layoutPanes } from "./utils";

/** Title shown on tabs / session list: live pane title wins over static session name. */
export function sessionDisplayTitle(session: Session): string {
  const first = layoutPanes(session.layout)[0];
  const dyn = first?.title?.trim();
  return dyn || session.title || `${t("terminal")} ?`;
}

type AgentStatusEntry = {
  kind?: AgentKind | null;
  status?: AgentStatus;
} | undefined;

/** First recognized agent across the session's panes (live status, then persisted). */
export function sessionPrimaryAgent(
  session: Session,
  agentStatus: Record<string, AgentStatusEntry> = {},
): AgentKind | null {
  const fromPane = layoutPanes(session.layout)
    .map((pane) => agentStatus[pane.id]?.kind ?? pane.agentKind ?? null)
    .find((kind): kind is AgentKind => Boolean(kind));
  return fromPane ?? session.agentKind ?? null;
}
