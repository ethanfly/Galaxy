/**
 * Forward xterm user input to the PTY.
 *
 * Mouse reports with DEFAULT encoding use onBinary (latin1 single-byte chars).
 * SGR (CSI ? 1006) uses onData (ASCII). Both must reach the PTY.
 *
 * DEFAULT reports MUST be written as raw bytes — UTF-8 string IPC corrupts
 * code points 128–255 (char+32 mouse coords), so the agent ignores clicks.
 * Exit/re-enter re-enables SGR (1006), which is why that "fixes" the bug.
 */

export interface DisposableLike {
  dispose(): void;
}

export interface TerminalInputSource {
  onData(listener: (data: string) => void): DisposableLike;
  onBinary(listener: (data: string) => void): DisposableLike;
}

/** Convert xterm onBinary latin1 string to 0–255 byte values. */
export function binaryStringToBytes(data: string): number[] {
  const bytes = new Array<number>(data.length);
  for (let i = 0; i < data.length; i += 1) {
    bytes[i] = data.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function attachTerminalUserInput(
  term: TerminalInputSource,
  sendText: (data: string) => void,
  sendBinary: (data: string) => void,
): () => void {
  const dataSub = term.onData(sendText);
  const binarySub = term.onBinary(sendBinary);
  return () => {
    dataSub.dispose();
    binarySub.dispose();
  };
}
