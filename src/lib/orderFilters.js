// Date inputs describe local calendar days, inclusive of the entire end day.
export function orderInDateRange(log, from, to) {
  if (!from && !to) return true;
  if (from && to && from > to) return false;
  const stamp = log.timestamp || log.createdAt;
  if (!stamp) return false;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return false;
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (!from || key >= from) && (!to || key <= to);
}
