import { NextRequest, NextResponse } from "next/server";

// Utility: get Zoom access token (Server-to-Server OAuth)
async function getZoomAccessToken() {
  const creds = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.HIGHVIEWTRAVEL_ZOOM_CLIENT_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: process.env.HIGHVIEWTRAVEL_ZOOM_ACCOUNT_ID || "",
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    console.error("Zoom token error:", errorData);
    throw new Error(
      `Failed to get Zoom access token: ${JSON.stringify(errorData)}`,
    );
  }

  const data = await res.json();
  return data.access_token as string;
}

// Utility: fetch upcoming webinars
async function getUpcomingWebinars(token: string) {
  const res = await fetch(
    "https://api.zoom.us/v2/users/me/webinars?type=upcoming&page_size=100",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) {
    throw new Error("Failed to fetch webinars");
  }

  const data = await res.json();
  return data.webinars ?? [];
}

// POST handler
export async function POST(req: NextRequest) {
  try {
    // Validate password
    const body = await req.json();
    const password = body.password;

    if (password !== process.env.HIGHVIEWTRAVEL_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await getZoomAccessToken();
    const webinars = await getUpcomingWebinars(token);

    const now = new Date();

    // Filter future webinars
    const upcoming = webinars.filter((w: any) => new Date(w.start_time) > now);

    if (upcoming.length === 0) {
      return NextResponse.json({
        active: false,
        start_time: null,
        join_url: null,
        topic: null,
        webinar_id: null,
        is_today: 0,
        is_tomorrow: 0,
      });
    }

    // Sort by soonest start time
    upcoming.sort(
      (a: any, b: any) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );

    const next = upcoming[0];

    return NextResponse.json({
      active: true,
      start_time: next.start_time, // ISO UTC
      join_url: next.join_url || null,
      topic: next.topic || null,
      webinar_id: next.id,
      is_today:
        new Date(next.start_time).toDateString() === now.toDateString() ? 1 : 0,
      is_tomorrow:
        new Date(next.start_time).toDateString() ===
        new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString()
          ? 1
          : 0,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to determine next webinar" },
      { status: 500 },
    );
  }
}
