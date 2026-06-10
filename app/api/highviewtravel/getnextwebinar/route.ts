import { NextRequest, NextResponse } from "next/server";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

/** Zoom webinar list item (from /users/me/webinars) */
interface ZoomWebinar {
  id: string;
  start_time: string;
  join_url?: string;
  topic?: string;
  [key: string]: unknown;
}

/**
 * Get Zoom access token (Server-to-Server OAuth)
 * Uses pre-encoded base64 credentials from env:
 * HIGHVIEWTRAVEL_ZOOM_CLIENT_SECRET
 */
async function getZoomAccessToken(): Promise<string> {
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
    throw new Error("Failed to get Zoom access token");
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Fetch upcoming webinars
 */
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

/**
 * Fetch full webinar details (to get registration_url)
 */
async function getWebinarDetails(token: string, webinarId: string) {
  const res = await fetch(`https://api.zoom.us/v2/webinars/${webinarId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch webinar details");
  }

  return await res.json();
}

/**
 * Format ISO date string as "Tuesday 1st July 2027 at 4:34pm" in America/New_York
 */
function formatStartTime(isoString: string): string {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const day = parseInt(get("day"));
  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th";

  const ampm = get("dayPeriod").toLowerCase();
  return `${get("weekday")} ${day}${suffix} ${get("month")} ${get("year")} at ${get("hour")}:${get("minute")}${ampm}`;
}

function toNYDateString(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

/**
 * POST handler
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const password = body.password;

    if (password !== process.env.HIGHVIEWTRAVEL_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401, headers: corsHeaders() });
    }

    const token = await getZoomAccessToken();
    const webinars = await getUpcomingWebinars(token);

    const now = new Date();

    const upcoming = (webinars as ZoomWebinar[])
      .filter((w) => new Date(w.start_time) > now)
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );

    if (upcoming.length === 0) {
      return NextResponse.json({
        active: false,
        start_time: null,
        start_time_formatted: null,
        start_date: null,
        join_url: null,
        registration_url: null,
        topic: null,
        webinar_id: null,
        is_today: 0,
        is_tomorrow: 0,
      }, { headers: corsHeaders() });
    }

    const next = upcoming[0];
    const startDateObj = new Date(next.start_time);

    const webinarDetails = await getWebinarDetails(token, next.id);

    const tomorrow = new Date(now);
    tomorrow.setTime(now.getTime() + 24 * 60 * 60 * 1000);

    return NextResponse.json({
      active: true,
      start_time: next.start_time,
      start_time_formatted: formatStartTime(next.start_time),
      start_date: startDateObj.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      }),
      join_url: next.join_url || null,
      registration_url: webinarDetails.registration_url || null,
      topic: next.topic || null,
      webinar_id: next.id,
      is_today: toNYDateString(startDateObj) === toNYDateString(now) ? 1 : 0,
      is_tomorrow:
        toNYDateString(startDateObj) === toNYDateString(tomorrow) ? 1 : 0,
    }, { headers: corsHeaders() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to determine next webinar" },
      { status: 500, headers: corsHeaders() },
    );
  }
}
