import type { AgentInsight } from "../../shared/ipc/types";
import { t } from "../../shared/i18n";
import { agentLabel } from "../terminal/AgentBadge";

export function AgentDistribution({ agents }: { agents: AgentInsight[] }) {
  const total = Math.max(1, agents.reduce((sum, agent) => sum + agent.commandCount, 0));
  return (
    <section className="insights-region agent-distribution-region" aria-labelledby="agent-distribution-title">
      <header className="insights-region-header">
        <h2 id="agent-distribution-title">{t("insightsAgentDistribution")}</h2>
        <span>{agents.length} 种工作模式</span>
      </header>
      <div className="agent-distribution-bar" aria-hidden="true">
        {agents.map((agent, index) => (
          <i
            key={agent.agentKind ?? "shell"}
            className={`agent-series-${index % 5}`}
            style={{ flexGrow: agent.commandCount / total }}
          />
        ))}
      </div>
      <div className="agent-distribution-list">
        {agents.map((agent, index) => (
          <div className="agent-distribution-row" key={agent.agentKind ?? "shell"}>
            <span className={`agent-color agent-series-${index % 5}`} />
            <span>{agent.agentKind ? agentLabel(agent.agentKind) : "普通 Shell"}</span>
            <span>{agent.sessionCount} 个会话</span>
            <strong>{agent.commandCount}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
