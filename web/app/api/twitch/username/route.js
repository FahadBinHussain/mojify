import { NextResponse } from "next/server";
import { findTwitchUser } from "../../../../lib/twitch";
import { isAllowedClient } from "../../../../lib/access";

export async function GET(request) {
  try {
    if (!isAllowedClient(request)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = (searchParams.get("id") || "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const user = await findTwitchUser({ id });
    if (!user) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    return NextResponse.json({ id: user.id, login: user.login, displayName: user.display_name });
  } catch (error) {
    return NextResponse.json({ error: error.message || "unexpected error" }, { status: 500 });
  }
}
