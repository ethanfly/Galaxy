import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IconStar, IconTerminal } from "./Icons";

describe("Galaxy icon contract", () => {
  it("applies the rounded monochrome stroke contract", () => {
    const { container } = render(<IconTerminal />);
    const svg = container.querySelector("svg");

    expect(svg?.classList.contains("galaxy-icon")).toBe(true);
    expect(svg?.classList.contains(["pixel", "icon"].join("-"))).toBe(false);
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    expect(svg?.getAttribute("stroke-linecap")).toBe("round");
    expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("fills only the active favorite", () => {
    const { container, rerender } = render(<IconStar />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("none");

    rerender(<IconStar filled />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });
});
