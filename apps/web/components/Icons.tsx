import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

function StrokeIcon({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M0 0h24v24H0z" opacity="0" />
      {children}
    </svg>
  );
}

export function ArrowIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 12h15.2M13.4 5.8l5.8 6.2-5.8 6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M8.2 5.6v12.8c0 .9 1 1.45 1.78.98l9.3-5.72a1.16 1.16 0 0 0 0-1.98l-9.3-6.02A1.16 1.16 0 0 0 8.2 5.6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M7.4 10.2 12 5.6l4.6 4.6M12 5.8v10.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14.2v3.2c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function CommandIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M8.2 8.2H6.3a2.7 2.7 0 1 1 2.7-2.7v13a2.7 2.7 0 1 1-2.7-2.7h11.4a2.7 2.7 0 1 1-2.7 2.7v-13a2.7 2.7 0 1 1 2.7 2.7H8.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function AiIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 3.2c.55 3.2 2.35 5 5.55 5.55C14.35 9.3 12.55 11.1 12 14.3c-.55-3.2-2.35-5-5.55-5.55C9.65 8.2 11.45 6.4 12 3.2zM18.3 14.4c.25 1.55 1.15 2.45 2.7 2.7-1.55.25-2.45 1.15-2.7 2.7-.25-1.55-1.15-2.45-2.7-2.7 1.55-.25 2.45-1.15 2.7-2.7zM5.5 14.5c.2 1.15.85 1.8 2 2-1.15.2-1.8.85-2 2-.2-1.15-.85-1.8-2-2 1.15-.2 1.8-.85 2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function CommentIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5.7 4.2h12.6c1.1 0 2 .9 2 2v8.2c0 1.1-.9 2-2 2H10l-4.7 3.2v-3.2c-.9-.2-1.6-1-1.6-2V6.2c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8.5h8M8 12.2h5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6.6 3.2h7.2l4.8 4.9v10.1c0 1.45-.88 2.3-2.3 2.3H6.6c-1.42 0-2.3-.85-2.3-2.3V5.5c0-1.45.88-2.3 2.3-2.3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.6 3.4v3.1c0 1.1.58 1.68 1.68 1.68h3.05" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function CodeIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m8.2 8.4-4 3.6 4 3.6M15.8 8.4l4 3.6-4 3.6M13.8 5.2l-3.6 13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function NoteIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6 3.5h12v17H6z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6M9 16h3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function CanvasIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.2 5.2h15.6v13.6H4.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9h4v4H8zM15.3 10.2h1.7M15.3 13.6h1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 12.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM5.4 20c.75-3 3.05-4.7 6.6-4.7s5.85 1.7 6.6 4.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 7.2a2.8 2.8 0 0 1 .2 5.55M21.1 19.2a5.3 5.3 0 0 0-3.1-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function SupportIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.8 12.8v-1.4a7.2 7.2 0 0 1 14.4 0v1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.2 11.6h1.5c.7 0 1.2.5 1.2 1.2v3.1c0 .7-.5 1.2-1.2 1.2H6.2c-.8 0-1.4-.6-1.4-1.4V13c0-.8.6-1.4 1.4-1.4zM16.3 11.6h1.5c.8 0 1.4.6 1.4 1.4v2.7c0 .8-.6 1.4-1.4 1.4h-1.5c-.7 0-1.2-.5-1.2-1.2v-3.1c0-.7.5-1.2 1.2-1.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.2 18.4h-2.1c-.75 0-1.35-.6-1.35-1.35v-.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function RenameIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.6 18.2v1.2h1.2l10.85-10.85a2.05 2.05 0 0 0-2.9-2.9L4.6 14.8v3.4zM12.8 6.6l4.6 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M8.4 8.4h9.7c1 0 1.7.7 1.7 1.7v8c0 1-.7 1.7-1.7 1.7h-8c-1 0-1.7-.7-1.7-1.7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.6 15.6h-.7c-1 0-1.7-.7-1.7-1.7v-9c0-1 .7-1.7 1.7-1.7h9c1 0 1.7.7 1.7 1.7v.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.2 6.8h15.6M9 6.8V5.3c0-1 .7-1.6 1.7-1.6h2.6c1 0 1.7.6 1.7 1.6v1.5M6.7 6.8l.85 11.4c.1 1.25.85 2 2.1 2h4.7c1.25 0 2-.75 2.1-2l.85-11.4M10 10.6v5.6M14 10.6v5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function FilePlusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6.6 3.2h7.2l4.8 4.9v10.1c0 1.45-.88 2.3-2.3 2.3H6.6c-1.42 0-2.3-.85-2.3-2.3V5.5c0-1.45.88-2.3 2.3-2.3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.6 3.4v3.1c0 1.1.58 1.68 1.68 1.68h3.05M12 17.2v-5M9.5 14.7h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function FolderPlusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3.6 7.3c0-1.35.85-2.2 2.2-2.2h4.05l2.1 2.5h6.25c1.35 0 2.2.85 2.2 2.2v7.1c0 1.35-.85 2.2-2.2 2.2H5.8c-1.35 0-2.2-.85-2.2-2.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 15.8v-4.4M9.8 13.6h4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3.6 7.3c0-1.35.85-2.2 2.2-2.2h4.05l2.1 2.5h6.25c1.35 0 2.2.85 2.2 2.2v7.1c0 1.35-.85 2.2-2.2 2.2H5.8c-1.35 0-2.2-.85-2.2-2.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M19.2 7.2A8.4 8.4 0 1 0 20 12M19.2 7.2V3.8M19.2 7.2h-3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function CollapseIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 7h14M8 12h8M10.5 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function SortIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M7 5h10M7 12h7M7 19h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function SortNameIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5.5 18.5 9 5.5l3.5 13M6.4 15h5.2M15.2 7h3.3l-3.6 5h3.8M15 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function SortChangesIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 5v7l4 2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 7.2A8.4 8.4 0 1 0 20 12M19.2 7.2V3.8M19.2 7.2h-3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function PanelHideIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.5 5.2h15v13.6h-15zM14.4 5.2v13.6M10.2 9.2 7.4 12l2.8 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function PanelShowIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.5 5.2h15v13.6h-15zM14.4 5.2v13.6M7.4 9.2l2.8 2.8-2.8 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.9 13.4a7.74 7.74 0 0 1 0-2.8l-1.55-1.2 1.85-3.2 1.85.75a8.2 8.2 0 0 1 2.42-1.4L9.75 3.6h3.7l.3 1.95a8.2 8.2 0 0 1 2.42 1.4l1.85-.75 1.85 3.2-1.55 1.2a7.74 7.74 0 0 1 0 2.8l1.55 1.2-1.85 3.2-1.85-.75a8.2 8.2 0 0 1-2.42 1.4l-.3 1.95h-3.7l-.3-1.95a8.2 8.2 0 0 1-2.42-1.4l-1.85.75-1.85-3.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M18.9 15.7A7.8 7.8 0 0 1 8.3 5.1 8.2 8.2 0 1 0 18.9 15.7z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 8.1a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8zM12 2.8v2.1M12 19.1v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M10.7 18.2a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM16 16l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function KeyboardIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.8 6.2h14.4c1 0 1.6.6 1.6 1.6v8.4c0 1-.6 1.6-1.6 1.6H4.8c-1 0-1.6-.6-1.6-1.6V7.8c0-1 .6-1.6 1.6-1.6zM6.5 10h.1M9.5 10h.1M12.5 10h.1M15.5 10h.1M18.4 10h.1M6.5 13h.1M9.5 13h.1M12.5 13h.1M15.5 13h.1M18.4 13h.1M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 3.2 19 6v5.2c0 4.2-2.65 7.55-7 9.6-4.35-2.05-7-5.4-7-9.6V6zM12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function UsageIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5.5 19V12M10 19V8M14.5 19V5M19 19v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 20.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </StrokeIcon>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.4 5.2h6.1v6.1H4.4zM13.5 5.2h6.1v3.9h-6.1zM4.4 14.1h6.1v4.7H4.4zM13.5 11.9h6.1v6.9h-6.1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.2 12h3.2l2.2-6.2 4.2 12.4 2.3-6.2h3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function GlobeIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.8 12h16.4M12 3.5c2.15 2.25 3.2 5.1 3.2 8.5s-1.05 6.25-3.2 8.5M12 3.5C9.85 5.75 8.8 8.6 8.8 12s1.05 6.25 3.2 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function ExtensionsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M8.2 4.2h7.6v4h1.3a2.6 2.6 0 1 1 0 5.2h-1.3v6.4H9.4v-1.3a2.6 2.6 0 1 0-5.2 0v1.3H2.8v-7.6h1.3a2.6 2.6 0 1 0 0-5.2H2.8V4.2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function DeveloperIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m8.2 8.4-4 3.6 4 3.6M15.8 8.4l4 3.6-4 3.6M13.8 5.2l-3.6 13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.8 20.5 20.2 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".45" />
    </StrokeIcon>
  );
}

export function GithubIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-1.94c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.34.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.7 5.38-5.26 5.67.41.35.77 1.04.77 2.1v3.12c0 .3.21.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function GoogleIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z" />
      <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

export function CursorIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.8 3.4c-.75-.3-1.48.43-1.18 1.18l6.85 16.7c.35.86 1.58.8 1.85-.08l1.85-6.03 6.05-1.85c.88-.27.94-1.5.08-1.85z" />
    </svg>
  );
}
