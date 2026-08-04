import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  blockRerun: vi.fn(async () => {}),
  blockSetFavorite: vi.fn(async () => {}),
}));

vi.mock("../../shared/ipc/client", () => ipcMocks);

import { setLanguage, t } from "../../shared/i18n";
import type { RecentActivity as RecentActivityItem } from "../../shared/ipc/types";
import { RecentActivity } from "./RecentActivity";

const item: RecentActivityItem = {
  id: "block-1",
  projectId: "project-1",
  projectName: "Galaxy",
  sessionId: "session-1",
  paneId: "pane-1",
  command: "npm test",
  startedAt: "2026-08-04T08:00:00Z",
  endedAt: "2026-08-04T08:00:01Z",
  exitCode: 0,
  agentKind: null,
  favorite: true,
  durationMs: 1000,
};

describe("RecentActivity operation icons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage("zh-CN");
  });

  it("keeps copy, favorite, and rerun actions named and functional", async () => {
    const onChanged = vi.fn();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { container } = render(
      <RecentActivity
        items={[item]}
        livePaneIds={new Set([item.paneId])}
        onOpen={vi.fn()}
        onChanged={onChanged}
      />,
    );

    const favorite = screen.getByRole("button", { name: t("insightsUnfavorite") });
    expect(favorite.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");

    fireEvent.click(screen.getByRole("button", { name: t("copyCommand") }));
    fireEvent.click(favorite);
    fireEvent.click(screen.getByRole("button", { name: t("insightsRerun") }));

    await waitFor(() => {
      expect(clipboard).toHaveBeenCalledWith(item.command);
      expect(ipcMocks.blockSetFavorite).toHaveBeenCalledWith(item.id, false);
      expect(ipcMocks.blockRerun).toHaveBeenCalledWith(item.id, item.paneId);
      expect(onChanged).toHaveBeenCalledOnce();
    });
    expect(container.querySelector(".recent-actions svg.galaxy-icon")).toBeTruthy();
  });
});
