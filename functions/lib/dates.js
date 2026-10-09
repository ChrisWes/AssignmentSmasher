// Claude sizes each milestone in days of focused work; this file turns that sizing into real
// calendar dates and flags whether the plan actually fits before the deadline. Keeping the date
// arithmetic here, in plain code, means it is exact and testable — not something re-derived by
// the model on every request.

const DEADLINE_BUFFER_DAYS = 3; // leave this many days before the real deadline as slack

function toUtcDate(isoDate) {
  return new Date(isoDate + 'T00:00:00Z');
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// milestones: [{ title, goal, duration_days, ... }] in working order.
// Returns the same milestones with a target_date added, plus whether the plan fits.
export function computeSchedule(startDate, endDate, milestones) {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  const totalDays = Math.round((end - start) / 86400000);
  const usableDays = Math.max(totalDays - DEADLINE_BUFFER_DAYS, 0);

  let cursor = 0;
  const scheduled = milestones.map((m) => {
    cursor += m.duration_days;
    return { ...m, target_date: isoDate(addDays(start, cursor)) };
  });

  const neededDays = milestones.reduce((sum, m) => sum + m.duration_days, 0);

  return {
    milestones: scheduled,
    total_days: totalDays,
    needed_days: neededDays,
    usable_days: usableDays,
    buffer_days: DEADLINE_BUFFER_DAYS,
    overcommitted: neededDays > usableDays
  };
}

// Expected pace vs actual, as a genuine day count rather than a milestone count, so milestones of
// very different sizes don't distort it. "Expected" is measured against the milestone schedule
// itself (cumulative duration_days), not the full calendar span to the deadline — the buffer days
// above are slack, not assigned to any milestone. Mirrored client-side in index.html's own
// computeProgress for the project detail page's live widget; this copy exists so the dashboard's
// project list can show a day count for every project without shipping each one's full outline.
export function computeProgress(startDate, milestones, neededDays) {
  const start = toUtcDate(startDate);
  const todayIso = isoDate(new Date());
  const todayUtc = toUtcDate(todayIso);
  const daysElapsed = Math.round((todayUtc - start) / 86400000);
  const expectedDays = Math.max(0, Math.min(daysElapsed, neededDays));
  const actualDays = milestones.reduce((sum, m) => sum + (m.done ? (Number(m.duration_days) || 0) : 0), 0);
  return {
    ahead_behind_days: actualDays - expectedDays,
    done_count: milestones.filter((m) => m.done).length,
    total_count: milestones.length
  };
}
