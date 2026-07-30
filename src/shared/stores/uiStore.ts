// Pure UI state (Zustand only — no business truth here, spec §3.1).
import { create } from "zustand";

export type RightPanelTab = "agent" | "git" | "history" | "notifications";
export type SettingsSection =
  | "general"
  | "workflows"
  | "templates"
  | "triggers"
  | "shortcuts"
  | "diagnostics";

interface UiState {
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  sidebarOpen: boolean;
  findBarOpen: boolean;
  blockSearchOpen: boolean;
  historySearchOpen: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  recoveryDialogOpen: boolean;
  workflowRunId: string | null;
  movePaneId: string | null;
  aboutOpen: boolean;

  openPanel(tab: RightPanelTab): void;
  togglePanel(tab?: RightPanelTab): void;
  closePanel(): void;
  toggleSidebar(): void;
  openFind(): void;
  closeFind(): void;
  openBlockSearch(): void;
  openHistorySearch(): void;
  openPalette(): void;
  closeOverlays(): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  openRecovery(): void;
  closeRecovery(): void;
  openWorkflowRun(id: string): void;
  closeWorkflowRun(): void;
  openMovePane(paneId: string): void;
  closeMovePane(): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  rightPanelOpen: false,
  rightPanelTab: "agent",
  sidebarOpen: true,
  findBarOpen: false,
  blockSearchOpen: false,
  historySearchOpen: false,
  paletteOpen: false,
  settingsOpen: false,
  settingsSection: "general",
  recoveryDialogOpen: false,
  workflowRunId: null,
  movePaneId: null,
  aboutOpen: false,

  openPanel(tab) {
    set({ rightPanelOpen: true, rightPanelTab: tab });
  },
  togglePanel(tab) {
    if (!tab) {
      set({ rightPanelOpen: !get().rightPanelOpen });
      return;
    }
    if (get().rightPanelOpen && get().rightPanelTab === tab) {
      set({ rightPanelOpen: false });
    } else {
      set({ rightPanelOpen: true, rightPanelTab: tab });
    }
  },
  closePanel() {
    set({ rightPanelOpen: false });
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },
  openFind() {
    set({ findBarOpen: true, blockSearchOpen: false, historySearchOpen: false, paletteOpen: false });
  },
  closeFind() {
    set({ findBarOpen: false });
  },
  openBlockSearch() {
    set({ blockSearchOpen: true, findBarOpen: false, historySearchOpen: false, paletteOpen: false });
  },
  openHistorySearch() {
    set({ historySearchOpen: true, findBarOpen: false, blockSearchOpen: false, paletteOpen: false });
  },
  openPalette() {
    set({ paletteOpen: true, findBarOpen: false, blockSearchOpen: false, historySearchOpen: false });
  },
  closeOverlays() {
    set({
      findBarOpen: false,
      blockSearchOpen: false,
      historySearchOpen: false,
      paletteOpen: false,
    });
  },
  openSettings(section = "general") {
    set({ settingsOpen: true, settingsSection: section });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
  openRecovery() {
    set({ recoveryDialogOpen: true });
  },
  closeRecovery() {
    set({ recoveryDialogOpen: false });
  },
  openWorkflowRun(id) {
    set({ workflowRunId: id });
  },
  closeWorkflowRun() {
    set({ workflowRunId: null });
  },
  openMovePane(paneId) {
    set({ movePaneId: paneId });
  },
  closeMovePane() {
    set({ movePaneId: null });
  },
}));
