/**
 * The app's one clock (`lib/time`).
 *
 * The bug these cover: `/log` computed week boundaries on the server (host clock
 * UTC) and day boundaries in the browser, so a session started before 08:00
 * GMT+8 was filed under the previous UTC day — the log showed a date the work
 * did not happen on. Every case below is an instant that lands on a DIFFERENT
 * calendar day in UTC than in GMT+8; if the app zone is ever read from the host,
 * these fail regardless of which machine runs them.
 */

import { describe, expect, it } from "vitest";
import {
  APP_TIME_ZONE_LABEL,
  APP_UTC_OFFSET_MINUTES,
  addDays,
  clockHhMm,
  dateKey,
  dayParts,
  mondayOf,
  startOfDay,
} from "@/lib/time";
import { groupByWeek } from "@/lib/facts";
import type { Session } from "@/types/db";

describe("the zone is GMT+8 and stated once", () => {
  it("is a fixed +8h offset", () => {
    expect(APP_UTC_OFFSET_MINUTES).toBe(480);
    expect(APP_TIME_ZONE_LABEL).toBe("GMT+8");
  });
});

describe("dateKey — the day a session belongs to", () => {
  it("files a 00:30 GMT+8 start on that day, not the UTC day before", () => {
    // 2026-08-18T00:30+08:00 === 2026-08-17T16:30Z
    expect(dateKey("2026-08-17T16:30:00.000Z")).toBe("2026-08-18");
  });

  it("files a 23:30 GMT+8 close on that day, not the UTC day it shares", () => {
    expect(dateKey("2026-08-18T15:30:00.000Z")).toBe("2026-08-18");
  });

  it("rolls at 16:00Z, which is midnight in the app zone", () => {
    expect(dateKey("2026-08-17T15:59:59.999Z")).toBe("2026-08-17");
    expect(dateKey("2026-08-17T16:00:00.000Z")).toBe("2026-08-18");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(dateKey(new Date("2026-08-17T16:30:00.000Z"))).toBe("2026-08-18");
  });
});

describe("startOfDay — the instant an app-zone day begins", () => {
  it("is 16:00Z the previous day", () => {
    expect(startOfDay("2026-08-18").toISOString()).toBe("2026-08-17T16:00:00.000Z");
  });

  it("round-trips with dateKey", () => {
    expect(dateKey(startOfDay("2026-08-18"))).toBe("2026-08-18");
  });
});

describe("addDays — calendar arithmetic on a key", () => {
  it("steps back across a month boundary", () => {
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("steps forward across a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("mondayOf — the week a session is filed under", () => {
  it("puts a Monday 00:30 GMT+8 start in ITS week, not the previous one", () => {
    // The regression: 2026-08-17T00:30+08:00 is Sunday 16:30Z, and a UTC Monday
    // walk filed it under the week starting 2026-08-10.
    expect(mondayOf("2026-08-16T16:30:00.000Z")).toBe("2026-08-17");
  });

  it("keeps a Sunday 23:30 GMT+8 close in the week that just ended", () => {
    // 2026-08-16T23:30+08:00 === 2026-08-16T15:30Z, a Sunday either way.
    expect(mondayOf("2026-08-16T15:30:00.000Z")).toBe("2026-08-10");
  });

  it("is idempotent on the Monday it returns", () => {
    expect(mondayOf(startOfDay("2026-08-17"))).toBe("2026-08-17");
  });
});

describe("clockHhMm — the 24-hour range on /log", () => {
  it("reads the app zone, not UTC", () => {
    expect(clockHhMm("2026-08-17T16:30:00.000Z")).toBe("00:30");
    expect(clockHhMm("2026-08-18T01:14:00.000Z")).toBe("09:14");
  });
});

describe("dayParts — the label fields", () => {
  it("names the weekday of the key itself", () => {
    expect(dayParts("2026-08-17")).toEqual({ weekday: "Mon", month: "Aug", dayOfMonth: 17 });
  });
});

describe("groupByWeek files by the app zone (the reported bug)", () => {
  function session(id: string, startedAt: string): Session {
    return {
      id,
      taskId: null,
      kind: "focus",
      parentSessionId: null,
      what: "work",
      why: "because",
      finishLine: "done",
      startedAt,
      endedAt: null,
      status: "done",
      expectedResumeAt: null,
      interruptTag: null,
      kindCorrectedTo: null,
      kindCorrectedAt: null,
      resumeCue: null,
      resumePlannedAt: null,
      lastInteractionAt: startedAt,
      checkInIntervalMinutes: null,
      outcomeNote: null,
      rearmCount: 0,
    } as Session;
  }

  it("keeps a Monday-morning session in the week the user worked it", () => {
    const weeks = groupByWeek(
      [session("early-monday", "2026-08-16T16:30:00.000Z")],
      [],
      new Date("2026-08-18T02:00:00.000Z"),
    );
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-08-17"]);
  });

  it("does not split one app-zone week into two", () => {
    const weeks = groupByWeek(
      [
        session("mon-early", "2026-08-16T16:30:00.000Z"), // Mon 00:30 GMT+8
        session("wed-late", "2026-08-19T15:30:00.000Z"), // Wed 23:30 GMT+8
      ],
      [],
      new Date("2026-08-20T02:00:00.000Z"),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekStart).toBe("2026-08-17");
  });
});
