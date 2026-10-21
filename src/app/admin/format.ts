export const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
