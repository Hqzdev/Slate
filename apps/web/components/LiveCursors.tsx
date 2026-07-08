"use client";

import { CursorIcon } from "@/components/Icons";

export type LiveCursorUser = {
  color: string;
  id: string;
  initials: string;
  name: string;
  role: string;
};

export type LiveCursor = {
  mode?: "percent" | "pixel";
  x: number;
  y: number;
  user: LiveCursorUser;
};

type LiveCursorsProps = {
  cursors: LiveCursor[];
  localUserId: string;
};

export function LiveCursors({ cursors, localUserId }: LiveCursorsProps) {
  return (
    <div className="live-cursor-layer">
      {cursors.filter((cursor) => cursor.user.id !== localUserId).map((cursor) => {
        const position = cursor.mode === "pixel" ? { left: cursor.x, top: cursor.y } : { left: `${cursor.x}%`, top: `${cursor.y}%` };
        return (
          <div className="live-cursor" key={cursor.user.id} style={position}>
            <span className="live-cursor-icon" style={{ color: cursor.user.color }}>
              <CursorIcon />
            </span>
            <b style={{ background: cursor.user.color }}>{cursor.user.name}</b>
          </div>
        );
      })}
    </div>
  );
}
