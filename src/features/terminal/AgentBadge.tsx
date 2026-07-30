// Pixel-styled agent badge — star-flavored marker for tabs/sidebar (spec §6).
import type { AgentKind } from "../../shared/ipc/types";

const LABELS: Record<AgentKind, string> = {
  claudeCode: "CC",
  codex: "CX",
  openCode: "OC",
  omp: "OM",
  grok: "GK",
  crush: "CR",
};

const NAMES: Record<AgentKind, string> = {
  claudeCode: "Claude Code",
  codex: "Codex CLI",
  openCode: "OpenCode",
  omp: "OMP",
  grok: "Grok Build",
  crush: "Crush",
};

export function AgentBadge({ kind }: { kind: AgentKind }) {
  return (
    <span
      className={`agent-badge kind-${kind}`}
      title={NAMES[kind]}
      aria-label={NAMES[kind]}
    >
      {LABELS[kind]}
    </span>
  );
}

export function agentLabel(kind: AgentKind): string {
  return NAMES[kind];
}
