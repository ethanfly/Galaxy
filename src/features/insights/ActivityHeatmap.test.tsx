import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DailyActivity } from "../../shared/ipc/types";
import { ActivityHeatmap } from "./ActivityHeatmap";

function days(): DailyActivity[] {
  const start = new Date("2025-08-05T00:00:00Z");
  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      commandCount: index === 364 ? 9 : 0,
      successCount: index === 364 ? 8 : 0,
      failureCount: index === 364 ? 1 : 0,
      agentCommandCount: index === 364 ? 5 : 0,
      activeDurationMs: index === 364 ? 90_000 : 0,
      level: index === 364 ? 4 : 0,
    };
  });
}

describe("ActivityHeatmap", () => {
  it("renders every returned day with factual accessible labels", () => {
    render(<ActivityHeatmap daily={days()} />);

    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(365);
    const active = screen.getByRole("gridcell", { name: /2026-08-04.*9 条命令.*8 成功.*1 失败/ });
    expect(active.className).toContain("activity-level-4");

    fireEvent.mouseEnter(active);
    expect(screen.getByRole("tooltip").textContent).toContain("1 分 30 秒");
  });

  it("moves focus between adjacent dates with arrow keys", () => {
    render(<ActivityHeatmap daily={days()} />);
    const cells = screen.getAllByRole("gridcell");
    act(() => (cells[10] as HTMLElement).focus());

    fireEvent.keyDown(cells[10], { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[11]);

    fireEvent.keyDown(cells[11], { key: "ArrowDown" });
    expect(document.activeElement).toBe(cells[18]);
  });
});
