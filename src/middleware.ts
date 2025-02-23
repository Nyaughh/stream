import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Allow WebSocket upgrade requests
  if (request.headers.get("upgrade") === "websocket") {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/socket/:path*"],
}; 