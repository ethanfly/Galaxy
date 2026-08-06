/**
 * Subscribe to `window.devicePixelRatio` changes (OS display scale or
 * moving across monitors). Uses the resolution media-query pattern xterm
 * uses — not polling.
 */
export function subscribeDevicePixelRatio(
  onChange: (dpr: number) => void,
  targetWindow: Window = window,
): () => void {
  let media: MediaQueryList | null = null;
  let disposed = false;

  const attach = () => {
    if (disposed) return;
    const dpr = targetWindow.devicePixelRatio || 1;
    try {
      media = targetWindow.matchMedia(`screen and (resolution: ${dpr}dppx)`);
    } catch {
      media = null;
      return;
    }
    media.addEventListener("change", onMediaChange);
  };

  const onMediaChange = () => {
    if (disposed) return;
    if (media) {
      media.removeEventListener("change", onMediaChange);
      media = null;
    }
    onChange(targetWindow.devicePixelRatio || 1);
    attach();
  };

  attach();

  return () => {
    disposed = true;
    if (media) {
      media.removeEventListener("change", onMediaChange);
      media = null;
    }
  };
}
