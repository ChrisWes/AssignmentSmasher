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
