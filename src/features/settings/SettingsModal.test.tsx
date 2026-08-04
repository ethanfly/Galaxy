import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../shared/ipc/types";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { SETTINGS_SECTIONS } from "./SettingsModal";
import { SettingsModal } from "./SettingsModal";

const config: AppConfig = {
  schemaVersion: 3,
  language: "zh-CN",
  terminalFontSize: 14,
  uiFontSize: 13,
  theme: "dark",
  defaultProfileId: null,
  customProfiles: [],
  globalHotkey: null,
  contextMenuEnabled: true,
  agentNotifications: true,
  triggerNotifications: true,
  shortcuts: [],
  statusbarComponents: [],
  windowState: { width: 1200, height: 800, maximized: false },
  layoutTemplates: [],
  workflows: [],
  triggers: [],
  featureFlags: { commandBlocks: true, agentPanel: true, gitPanel: true, workflows: true, triggers: true },
  hardwareAcceleration: true,
};

describe("settings chapter navigation", () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: true, settingsSection: "general" });
    useAppStore.setState({ config, profiles: [], error: null });
  });

  it("exposes the focused settings chapters with stable translated keys", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "general",
      "workflows",
      "templates",
      "triggers",
      "shortcuts",
      "diagnostics",
    ]);
    expect(SETTINGS_SECTIONS.every((section) => section.labelKey.length > 0)).toBe(true);
  });

  it("marks the selected chapter for assistive technology", async () => {
    render(<SettingsModal />);

    const general = await screen.findByRole("button", { name: "通用" });
    expect(general.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Workflows" }).getAttribute("aria-current")).toBeNull();
  });
});
