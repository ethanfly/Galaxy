import {
  Bell,
  Bot,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Copy,
  Folder,
  GitBranch,
  History,
  Minus,
  MoveRight,
  PanelLeft,
  PanelsTopLeft,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Rows2,
  Settings,
  Square,
  SquareTerminal,
  Star,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type GalaxyIconProps = Omit<LucideProps, "size" | "strokeWidth"> & {
  size?: number;
};

function galaxyIcon(Component: LucideIcon, name: string, defaultSize = 16) {
  function GalaxyIcon({ size = defaultSize, className, ...props }: GalaxyIconProps) {
    return (
      <Component
        {...props}
        className={["galaxy-icon", className].filter(Boolean).join(" ")}
        size={size}
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
        focusable="false"
      />
    );
  }

  GalaxyIcon.displayName = name;
  return GalaxyIcon;
}

export const IconTerminal = galaxyIcon(SquareTerminal, "IconTerminal");
export const IconInsights = galaxyIcon(ChartNoAxesColumnIncreasing, "IconInsights");
export const IconHistory = galaxyIcon(History, "IconHistory");
export const IconSidebar = galaxyIcon(PanelLeft, "IconSidebar");
export const IconAgent = galaxyIcon(Bot, "IconAgent");
export const IconGit = galaxyIcon(GitBranch, "IconGit");
export const IconBell = galaxyIcon(Bell, "IconBell");
export const IconSettings = galaxyIcon(Settings, "IconSettings");
export const IconFolder = galaxyIcon(Folder, "IconFolder");
export const IconSessions = galaxyIcon(PanelsTopLeft, "IconSessions");
export const IconPlus = galaxyIcon(Plus, "IconPlus");
export const IconClose = galaxyIcon(X, "IconClose");
export const IconCopy = galaxyIcon(Copy, "IconCopy");
export const IconSplitRight = galaxyIcon(Columns2, "IconSplitRight");
export const IconSplitDown = galaxyIcon(Rows2, "IconSplitDown");
export const IconMove = galaxyIcon(MoveRight, "IconMove");
export const IconSyncInput = galaxyIcon(RadioTower, "IconSyncInput");
export const IconPrompt = galaxyIcon(ChevronRight, "IconPrompt");
export const IconRefresh = galaxyIcon(RefreshCw, "IconRefresh");
export const IconRerun = galaxyIcon(RotateCcw, "IconRerun");
export const IconPlay = galaxyIcon(Play, "IconPlay");
export const IconAlert = galaxyIcon(TriangleAlert, "IconAlert");
export const IconMinimize = galaxyIcon(Minus, "IconMinimize", 12);
export const IconMaximize = galaxyIcon(Square, "IconMaximize", 12);
export const IconRestore = galaxyIcon(Copy, "IconRestore", 12);
export const IconChevronUp = galaxyIcon(ChevronUp, "IconChevronUp");
export const IconChevronDown = galaxyIcon(ChevronDown, "IconChevronDown");
export const IconCheck = galaxyIcon(Check, "IconCheck");
export const IconTrash = galaxyIcon(Trash2, "IconTrash");

export function IconStar({ fill, ...props }: GalaxyIconProps & { filled?: boolean }) {
  const { filled = false, ...iconProps } = props;
  return <StarIcon {...iconProps} fill={filled ? "currentColor" : (fill ?? "none")} />;
}

const StarIcon = galaxyIcon(Star, "IconStar");
