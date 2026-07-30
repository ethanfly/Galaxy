export function getCurrentWindow() {
  return {
    minimize: async () => {},
    close: async () => {},
    toggleMaximize: async () => {},
    isMaximized: async () => false,
    onResized: async () => () => {},
    startDragging: async () => {},
  };
}
