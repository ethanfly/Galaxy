/**
 * Fire when the document / window becomes interactive again after being
 * hidden, minimized, or unfocused long enough that WebView2 may have
 * invalidated canvas/char metrics (TUI mouse + scrollbar).
 */
export function subscribeResumeInteraction(
  onResume: () => void,
  target: Window & typeof globalThis = window,
): () => void {
  let lastFire = 0;
  const minIntervalMs = 250;

  const fire = () => {
    const now = Date.now();
    if (now - lastFire < minIntervalMs) return;
    lastFire = now;
    onResume();
  };

  const onVisibility = () => {
    if (target.document.visibilityState === "visible") fire();
  };
  const onFocus = () => fire();
  const onPageShow = (ev: PageTransitionEvent) => {
    // bfcache / resume from sleep
    if (ev.persisted || target.document.visibilityState === "visible") fire();
  };

  target.document.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("focus", onFocus);
  target.addEventListener("pageshow", onPageShow);

  return () => {
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("pageshow", onPageShow);
  };
}
