// Galaxy pixel icons — 14×14 crisp SVGs (no emoji/Unicode blur).
// Use `currentColor` so CSS / icon-btn colors apply.

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  title?: string;
};

function IconBase({
  size = 14,
  title,
  children,
  className,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={["pixel-icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** App / project star */
export function IconStar(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 1h2v1H6V1zm-1 2h4v1H5V3zM3 5h8v1H3V5zm1 2h6v1H4V7zm1 2h4v1H5V9zm1 2h2v1H6v-1z" />
      <path d="M1 6h1v2H1V6zm11 0h1v2h-1V6z" opacity=".85" />
    </IconBase>
  );
}

/** Sidebar toggle */
export function IconSidebar(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 1h12v12H1V1zm1 1v10h3V2H2zm4 0v10h6V2H6z" />
      <path d="M3 4h1v1H3V4zm0 2h1v1H3V6zm0 2h1v1H3V8z" opacity=".9" />
    </IconBase>
  );
}

/** Agent / sparkle */
export function IconAgent(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 0h2v2H6V0zM6 12h2v2H6v-2zM0 6h2v2H0V6zm12 0h2v2h-2V6z" />
      <path d="M4 4h6v6H4V4zm1 1v4h4V5H5z" />
      <path d="M3 2h1v1H3V2zm7 0h1v1h-1V2zM3 11h1v1H3v-1zm7 0h1v1h-1v-1z" opacity=".75" />
    </IconBase>
  );
}

/** Git branch */
export function IconGit(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M3 1h2v2H3V1zm0 10h2v2H3v-2zm6-5h2v2H9V6z" />
      <path d="M4 3h1v3H4V3zm0 5h1v3H4V8z" />
      <path d="M5 5h3v1H5V5zm3 0h1v2H8V5z" />
    </IconBase>
  );
}

/** History / list */
export function IconHistory(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 2h10v1H2V2zm0 3h10v1H2V5zm0 3h10v1H2V8zm0 3h7v1H2v-1z" />
    </IconBase>
  );
}

/** Notifications / bell */
export function IconBell(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 1h2v1H6V1zM4 3h6v1H4V3zM3 4h8v5H3V4zm1 5h6v1H4V9zM5 11h4v1H5v-1zM6 12h2v1H6v-1z" />
      <path d="M2 4h1v3H2V4zm9 0h1v3h-1V4z" opacity=".8" />
    </IconBase>
  );
}

/** Settings / gear */
export function IconSettings(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 1h2v2H6V1zM6 11h2v2H6v-2zM1 6h2v2H1V6zm10 0h2v2h-2V6z" />
      <path d="M3 3h2v2H3V3zm6 0h2v2H9V3zM3 9h2v2H3V9zm6 0h2v2H9V9z" opacity=".85" />
      <path d="M5 5h4v4H5V5zm1 1v2h2V6H6z" />
    </IconBase>
  );
}

/** Plus / new */
export function IconPlus(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 2h2v10H6V2zM2 6h10v2H2V6z" />
    </IconBase>
  );
}

/** Close / X */
export function IconClose(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 2h2v1H3v1H2V2zm8 0h2v2h-1V3h-1V2zM4 4h1v1H4V4zm5 0h1v1H9V4zM5 5h1v1H5V5zm3 0h1v1H8V5zM6 6h2v2H6V6zM5 8h1v1H5V8zm3 0h1v1H8V8zM4 9h1v1H4V9zm5 0h1v1H9V9zM2 10h2v2H3v-1H2v-1zm9 0h1v1h1v1h-2v-2z" />
    </IconBase>
  );
}
export const IconX = IconClose;

/** Split right */
export function IconSplitRight(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 2h12v10H1V2zm1 1v8h4V3H2zm6 0v8h4V3H8z" />
      <path d="M6 2h1v10H6V2z" />
    </IconBase>
  );
}

/** Split down */
export function IconSplitDown(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 2h12v10H1V2zm1 1v3h10V3H2zm0 5v3h10V8H2z" />
      <path d="M1 6h12v1H1V6z" />
    </IconBase>
  );
}

/** Move pane */
export function IconMove(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 3h6v1H2V3zm0 3h5v1H2V6zm0 3h4v1H2V9z" />
      <path d="M9 4h1v1H9V4zm1 1h1v1h-1V5zm1 1h1v2h-1V6zm-1 2h1v1h-1V8zM9 9h1v1H9V9z" />
      <path d="M10 3h3v1h-2v1h-1V3zm0 7h1v1h2v1H10v-2z" opacity=".9" />
    </IconBase>
  );
}

/** Sync input */
export function IconSync(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 4h6v1H2V4zm0 2h5v1H2V6zm0 2h4v1H2V8z" />
      <path d="M9 3h1v1h1v1h1v1h-1v1h-1v1H9V3zm1 2v2h1V5h-1z" />
      <path d="M11 9h1v2h-3v-1h2V9z" />
    </IconBase>
  );
}

/** Terminal / prompt */
export function IconTerminal(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 2h12v10H1V2zm1 1v8h10V3H2z" />
      <path d="M3 5h1v1H3V5zm1 1h1v1H4V6zm1 1h1v1H5V7zM7 7h3v1H7V7z" />
    </IconBase>
  );
}

/** Folder */
export function IconFolder(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 3h5l1 1h6v8H1V3zm1 2v6h10V5H2z" />
    </IconBase>
  );
}

/** Sessions / panes grid */
export function IconSessions(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M1 1h5v5H1V1zm1 1v3h3V2H2zm6-1h5v5H8V1zm1 1v3h3V2H9zM1 8h5v5H1V8zm1 1v3h3V9H2zm6-1h5v5H8V8zm1 1v3h3V9H9z" />
    </IconBase>
  );
}

/** Chevron / shell prompt */
export function IconPrompt(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M3 3h1v1H3V3zm1 1h1v1H4V4zm1 1h1v2H5V5zm-1 2h1v1H4V7zm-1 1h1v1H3V8zM7 8h4v1H7V8z" />
    </IconBase>
  );
}

/** Window minimize */
export function IconMinimize(p: IconProps) {
  return (
    <IconBase {...p} size={p.size ?? 12}>
      <path d="M2 7h10v2H2V7z" />
    </IconBase>
  );
}

/** Window maximize */
export function IconMaximize(p: IconProps) {
  return (
    <IconBase {...p} size={p.size ?? 12}>
      <path d="M2 2h10v10H2V2zm1 1v8h8V3H3z" />
    </IconBase>
  );
}

/** Window restore */
export function IconRestore(p: IconProps) {
  return (
    <IconBase {...p} size={p.size ?? 12}>
      <path d="M4 2h8v8H4V2zm1 1v6h6V3H5z" />
      <path d="M2 4h1v8h8v1H2V4z" opacity=".9" />
    </IconBase>
  );
}

/** Search prev */
export function IconChevronUp(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 3h2v1H6V3zM4 5h2v1H4V5zm4 0h2v1H8V5zM3 7h2v1H3V7zm6 0h2v1H9V7zM2 9h2v1H2V9zm8 0h2v1h-2V9z" />
    </IconBase>
  );
}

/** Search next */
export function IconChevronDown(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M2 3h2v1H2V3zm8 0h2v1h-2V3zM3 5h2v1H3V5zm6 0h2v1H9V5zM4 7h2v1H4V7zm4 0h2v1H8V7zM6 9h2v1H6V9z" />
    </IconBase>
  );
}

/** Refresh */
export function IconRefresh(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M4 2h6v1H5v1H4V2zm6 1h1v3h-1V3zM3 4h1v5H3V4zm1 5h1v1H4V9zm1 1h5v1H5v-1zm5-1h1v1h-1V9z" />
      <path d="M9 2h1v1H9V2zm1 0h2v2h-1V3h-1V2z" />
    </IconBase>
  );
}

/** Play / working */
export function IconPlay(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M4 2h2v1H5v1H4V2zm2 2h2v1H6V4zm2 2h2v2H8V6zM6 8h2v1H6V8zm-2 2h2v1H5v1H4v-2z" />
      <path d="M5 3h1v1H5V3zm1 1h1v1H6V4zm1 1h1v1H7V5zm0 2h1v1H7V7zm-1 1h1v1H6V8zm-1 1h1v1H5V9z" />
    </IconBase>
  );
}

/** Alert / blocked */
export function IconAlert(p: IconProps) {
  return (
    <IconBase {...p}>
      <path d="M6 1h2v1H6V1zM5 3h4v1H5V3zM4 5h6v1H4V5zM3 7h8v1H3V7zM2 9h10v1H2V9zM6 10h2v2H6v-2z" />
      <path d="M6 4h2v3H6V4z" opacity=".95" />
    </IconBase>
  );
}
