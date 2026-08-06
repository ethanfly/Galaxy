import { describe, expect, it, vi } from "vitest";

import { attachTerminalUserInput, binaryStringToBytes } from "./terminalInput";

describe("binaryStringToBytes", () => {
  it("maps each char code to a single 0–255 byte (DEFAULT mouse coords)", () => {
    // ESC M + three high bytes as used by DEFAULT mouse encoding
    const s = `\x1b[M${String.fromCharCode(160)}${String.fromCharCode(200)}${String.fromCharCode(40)}`;
    expect(binaryStringToBytes(s)).toEqual([0x1b, 0x5b, 0x4d, 160, 200, 40]);
  });
});

describe("attachTerminalUserInput", () => {
  it("routes onData to text and onBinary to binary sender", () => {
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
    const sendText = vi.fn();
    const sendBinary = vi.fn();
    attachTerminalUserInput(term, sendText, sendBinary);

    dataListeners[0]!("a");
    binaryListeners[0]!("\x1b[M #!");

    expect(sendText).toHaveBeenCalledWith("a");
    expect(sendBinary).toHaveBeenCalledWith("\x1b[M #!");
    expect(sendText).not.toHaveBeenCalledWith("\x1b[M #!");
  });

  it("disposes both subscriptions", () => {
    const disposeData = vi.fn();
    const disposeBinary = vi.fn();
    const term = {
      onData: () => ({ dispose: disposeData }),
      onBinary: () => ({ dispose: disposeBinary }),
    };
    const detach = attachTerminalUserInput(term, vi.fn(), vi.fn());
    detach();
    expect(disposeData).toHaveBeenCalled();
    expect(disposeBinary).toHaveBeenCalled();
  });
});
