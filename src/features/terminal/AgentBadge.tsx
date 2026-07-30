// Pixel-styled agent badge — star-flavored marker for tabs/sidebar (spec §6).
import type { AgentKind } from "../../shared/ipc/types";

const LABELS: Record<AgentKind, string> = {
  claudeCode: "CC",
  codex: "CX",
  openCode: "OC",
  omp: "OM",
  grok: "GK",
  crush: "CR",
  gemini: "GM",
  copilot: "CP",
  aider: "AD",
  goose: "GS",
  qwen: "QW",
  kimi: "KM",
  cline: "CL",
  roo: "RO",
  continue: "CN",
  cursor: "CU",
  pi: "PI",
  hermes: "HM",
  openClaw: "OW",
  antigravity: "AG",
  amp: "AM",
};

const NAMES: Record<AgentKind, string> = {
  claudeCode: "Claude Code",
  codex: "Codex CLI",
  openCode: "OpenCode",
  omp: "OMP",
  grok: "Grok Build",
  crush: "Crush",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot CLI",
  aider: "Aider",
  goose: "Goose",
  qwen: "Qwen Code",
  kimi: "Kimi CLI",
  cline: "Cline",
  roo: "Roo Code",
  continue: "Continue",
  cursor: "Cursor Agent",
  pi: "Pi",
  hermes: "Hermes",
  openClaw: "OpenClaw",
  antigravity: "Antigravity",
  amp: "Amp / Factory",
};

export function AgentBadge({ kind }: { kind: AgentKind }) {
  return (
    <span
      className={`agent-badge kind-${kind}`}
      title={NAMES[kind] ?? kind}
      aria-label={NAMES[kind] ?? kind}
    >
      {LABELS[kind] ?? kind.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function agentLabel(kind: AgentKind): string {
  return NAMES[kind] ?? kind;
}
