export function newsFresh(item: {
  eventDate: Date | null;
  retrievedAt: Date;
  status: string;
}) {
  const age = item.eventDate ? Date.now() - item.eventDate.getTime() : Infinity;
  return (
    item.status === "verified" &&
    age >= -3600000 &&
    age <= 14 * 86400000 &&
    Date.now() - item.retrievedAt.getTime() <= 3 * 86400000
  );
}
