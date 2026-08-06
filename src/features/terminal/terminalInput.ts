/**
 * Forward xterm user input to the PTY.
 *
 * Mouse reports with DEFAULT encoding use onBinary; SGR (CSI ? 1006) uses
 * onData. Both must be wired or TUI clicks silently vanish after encoding
 * falls back to DEFAULT (common after long idle / soft reset).
 */

export interface DisposableLike {
  dispose(): void;
}

export interface TerminalInputSource {
  onData(listener: (data: string) => void): DisposableLike;
  onBinary(listener: (data: string) => void): DisposableLike;
}

export function attachTerminalUserInput(
  term: TerminalInputSource,
  send: (data: string) => void,
): () => void {
  const dataSub = term.onData(send);
  const binarySub = term.onBinary(send);
  return () => {
    dataSub.dispose();
    binarySub.dispose();
  };
}
