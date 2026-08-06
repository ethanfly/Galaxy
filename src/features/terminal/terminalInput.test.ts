import { describe, expect, it, vi } from "vitest";

import { attachTerminalUserInput } from "./terminalInput";

describe("attachTerminalUserInput", () => {
  it("forwards both onData and onBinary (DEFAULT mouse encoding)", () => {
    const dataListeners: Array<(d: string) => void> = [];
    const binaryListeners: Array<(d: string) => void> = [];
    const term = {
      onData: (listener: (d: string) => void) => {
        dataListeners.push(listener);
        return { dispose: () => {} };
      },
      onBinary: (listener: (d: string) => void) => {
        binaryListeners.push(listener);
        return { dispose: () => {} };
      },
    };
    const send = vi.fn();
    const detach = attachTerminalUserInput(term, send);

    expect(dataListeners).toHaveLength(1);
    expect(binaryListeners).toHaveLength(1);

    // Keyboard / SGR mouse
    dataListeners[0]!("a");
    // DEFAULT encoding mouse report (binary path)
    binaryListeners[0]!("\x1b[M #!");

    expect(send).toHaveBeenCalledWith("a");
    expect(send).toHaveBeenCalledWith("\x1b[M #!");
    expect(send).toHaveBeenCalledTimes(2);

    detach();
  });

  it("disposes both subscriptions", () => {
    const disposeData = vi.fn();
    const disposeBinary = vi.fn();
    const term = {
      onData: () => ({ dispose: disposeData }),
      onBinary: () => ({ dispose: disposeBinary }),
    };
    const detach = attachTerminalUserInput(term, vi.fn());
    detach();
    expect(disposeData).toHaveBeenCalled();
    expect(disposeBinary).toHaveBeenCalled();
  });
});
