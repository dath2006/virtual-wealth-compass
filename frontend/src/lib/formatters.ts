import { format, formatDistanceToNow } from "date-fns";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFormatterSigned = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  signDisplay: "always",
});

export const fmtINR = (n: number) => inrFormatter.format(Math.round(n));
export const fmtINRSigned = (n: number) => inrFormatterSigned.format(Math.round(n));

export const fmtNumber = (n: number) =>
  new Intl.NumberFormat("en-IN").format(Math.round(n));

export const fmtTime = (ms: number) => format(new Date(ms), "dd MMM, hh:mm a");
export const fmtDate = (ms: number) => format(new Date(ms), "dd MMM yyyy");
export const fmtRelative = (ms: number) =>
  formatDistanceToNow(new Date(ms), { addSuffix: true });

export const fmtDuration = (totalMin: number) => {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

export const toISODate = (ms: number) =>
  format(new Date(ms), "yyyy-MM-dd");
