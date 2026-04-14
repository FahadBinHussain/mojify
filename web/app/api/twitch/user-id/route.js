import { NextResponse } from "next/server";
import { findTwitchUser } from "../../../../lib/twitch";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const username = (searchParams.get("username") || "").trim().toLowerCase();
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const user = await findTwitchUser({ username });
    if (!user) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    return NextResponse.json({ id: user.id, login: user.login, displayName: user.display_name });
  } catch (error) {
    return NextResponse.json({ error: error.message || "unexpected error" }, { status: 500 });
  }
}
