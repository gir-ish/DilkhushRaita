import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const STAFF = ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER", "MARKETING"];

async function readSession(req: NextRequest) {
  const token = req.cookies.get("dk_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.SESSION_SECRET)
    );
    return payload as { uid: string; role: string };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const session = await readSession(req);
    if (!session || !STAFF.includes(session.role)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/account") || pathname.startsWith("/checkout")) {
    const session = await readSession(req);
    if (!session || session.role !== "CUSTOMER") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*", "/checkout/:path*"],
};
