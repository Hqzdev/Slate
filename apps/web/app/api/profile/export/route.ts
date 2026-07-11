import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await authService.getCurrentSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const devices = await authService.listUserSessions(session.userId, session.id);
  const rows = [
    ["Field", "Value"],
    ["User ID", session.user.id],
    ["Name", session.user.name],
    ["Email", session.user.email],
    ["Initials", session.user.initials],
    ["Accent Color", session.user.color],
    ["Created At", session.user.createdAt.toISOString()],
    ["Updated At", session.user.updatedAt.toISOString()],
    ["Device Count", String(devices.length)],
    ...devices.flatMap((device, index) => [
      [`Device ${index + 1}`, device.deviceName],
      [`Device ${index + 1} OS`, device.operatingSystem],
      [`Device ${index + 1} Browser`, device.browserName],
      [`Device ${index + 1} Current`, device.current ? "Yes" : "No"],
      [`Device ${index + 1} IP`, device.ipAddress ?? ""],
      [`Device ${index + 1} Last Login`, device.createdAt],
      [`Device ${index + 1} Last Seen`, device.lastSeenAt],
      [`Device ${index + 1} Expires`, device.expiresAt]
    ])
  ];

  return new NextResponse(toSpreadsheet(rows), {
    headers: {
      "content-disposition": "attachment; filename=\"slate-profile.xls\"",
      "content-type": "application/vnd.ms-excel; charset=utf-8"
    }
  });
}

function toSpreadsheet(rows: string[][]) {
  const cells = rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Profile"><Table>${cells}</Table></Worksheet>
</Workbook>`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
