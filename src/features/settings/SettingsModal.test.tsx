import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  autoCheckUpdate: true,
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
    useUiStore.setState({
      settingsOpen: true,
      settingsSection: "general",
      appearancePreview: null,
    });
    useAppStore.setState({
      config,
      profiles: [],
      error: null,
      setConfig: async () => true,
    });
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

  it("places global hotkey capture under the shortcuts chapter, not general", async () => {
    render(<SettingsModal />);

    expect(screen.queryByText("全局热键")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));

    expect(await screen.findByText("全局热键")).toBeTruthy();
    expect(screen.getByRole("button", { name: "（禁用 · 点击设置）" })).toBeTruthy();
  });

  it("records a global hotkey via click-then-keydown", async () => {
    render(<SettingsModal />);
    fireEvent.click(await screen.findByRole("button", { name: "快捷键" }));
    fireEvent.click(await screen.findByRole("button", { name: "（禁用 · 点击设置）" }));

    expect(screen.getByRole("button", { name: "按下新快捷键…" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ctrl+Alt+T" })).toBeTruthy();
    });
  });

  it("names compact add and remove controls by their operation", async () => {
    useAppStore.setState({
      config: { ...config, statusbarComponents: ["cwd"] },
      profiles: [],
      error: null,
    });

    render(<SettingsModal />);

    expect(await screen.findByRole("button", { name: "移除状态栏组件 cwd" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加自定义 Shell Profile" })).toBeTruthy();
  });
});

describe("settings appearance preview", () => {
  beforeEach(() => {
    useUiStore.setState({
      settingsOpen: true,
      settingsSection: "general",
      appearancePreview: null,
    });
    useAppStore.setState({
      config,
      profiles: [],
      error: null,
      setConfig: async () => true,
    });
  });

  it("clears a stale preview when opening from persisted config", () => {
    useUiStore.setState({ appearancePreview: { terminalFontSize: 20, uiFontSize: 18 } });

    render(<SettingsModal />);

    expect(useUiStore.getState().appearancePreview).toBeNull();
  });

  it("publishes a complete preview pair while editing the font drafts", () => {
    render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });

    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("keeps focus in the appearance input while its draft rerenders", () => {
    render(<SettingsModal />);

    const [terminalInput] = screen.getAllByRole("spinbutton");
    terminalInput.focus();
    fireEvent.change(terminalInput, { target: { value: "20" } });

    expect(document.activeElement).toBe(terminalInput);
  });

  it("retains the last valid preview when a font draft becomes empty or out of range", () => {
    render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    fireEvent.change(terminalInput, { target: { value: "" } });
    fireEvent.change(uiInput, { target: { value: "25" } });
    fireEvent.change(terminalInput, { target: { value: "20.5" } });

    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("does not enable Save for fractional appearance values", () => {
    render(<SettingsModal />);

    const [terminalInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20.5" } });

    expect(screen.getByRole("dialog").querySelector(".btn.primary")).toHaveProperty(
      "disabled",
      true,
    );
    expect(useUiStore.getState().appearancePreview).toBeNull();
  });

  it("cancels an appearance preview without changing the persisted config", () => {
    render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(useUiStore.getState().appearancePreview).toBeNull();
    expect(useAppStore.getState().config).toEqual(config);
  });

  it("clears the preview after a successful save updates the persisted config", async () => {
    useAppStore.setState({
      setConfig: async (next) => {
        useAppStore.setState({ config: next, error: null });
        return true;
      },
    });
    render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useUiStore.getState().appearancePreview).toBeNull();
    expect(useAppStore.getState().config).toMatchObject({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("keeps the modal and preview open when saving fails", async () => {
    useAppStore.setState({ setConfig: async () => false });
    render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("blocks dismissal and duplicate saves until an async save settles", async () => {
    let resolveSave!: (ok: boolean) => void;
    const save = vi.fn(
      (next: AppConfig) =>
        new Promise<boolean>((resolve) => {
          resolveSave = (ok) => {
            if (ok) useAppStore.setState({ config: next });
            resolve(ok);
          };
        }),
    );
    useAppStore.setState({ setConfig: save });
    render(<SettingsModal />);

    const dialog = screen.getByRole("dialog");
    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    const saveButton = dialog.querySelector<HTMLButtonElement>(".modal-footer .btn.primary")!;
    const cancelButton = dialog.querySelector<HTMLButtonElement>(".modal-footer .btn:not(.primary)")!;
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(cancelButton);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saveButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      resolveSave(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a failed delayed save open and restores dismissal afterward", async () => {
    let resolveSave!: (ok: boolean) => void;
    useAppStore.setState({
      setConfig: async () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    });
    render(<SettingsModal />);

    const dialog = screen.getByRole("dialog");
    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    fireEvent.click(dialog.querySelector<HTMLButtonElement>(".modal-footer .btn.primary")!);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {
      resolveSave(false);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(dialog.querySelector<HTMLButtonElement>(".modal-footer .btn")?.disabled).toBe(false),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("clears the preview when the settings modal unmounts", () => {
    const { unmount } = render(<SettingsModal />);

    const [terminalInput, uiInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(terminalInput, { target: { value: "20" } });
    fireEvent.change(uiInput, { target: { value: "18" } });
    unmount();

    expect(useUiStore.getState().appearancePreview).toBeNull();
  });
});
