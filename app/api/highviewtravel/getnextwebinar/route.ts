import { NextRequest, NextResponse } from "next/server";

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
 * Format ISO date string as "Tuesday 1st July 2027 at 4:34pm"
 */
function formatStartTime(isoString: string): string {
  const d = new Date(isoString);
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = d.getDate();
  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th";
  const hours = d.getHours();
  const mins = d.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 || 12;
  const minsPadded = mins < 10 ? `0${mins}` : `${mins}`;
  const timeStr = `${hour12}:${minsPadded}${ampm}`;
  return `${dayNames[d.getDay()]} ${day}${suffix} ${monthNames[d.getMonth()]} ${d.getFullYear()} at ${timeStr}`;
}

/**
 * POST handler
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const password = body.password;

    if (password !== process.env.HIGHVIEWTRAVEL_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
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
        start_time_formated: null,
        start_date: null,
        join_url: null,
        registration_url: null,
        topic: null,
        webinar_id: null,
        is_today: 0,
        is_tomorrow: 0,
      });
    }

    const next = upcoming[0];
    const startDateObj = new Date(next.start_time);

    const webinarDetails = await getWebinarDetails(token, next.id);

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

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
      is_today: startDateObj.toDateString() === now.toDateString() ? 1 : 0,
      is_tomorrow:
        startDateObj.toDateString() === tomorrow.toDateString() ? 1 : 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to determine next webinar" },
      { status: 500 },
    );
  }
}
