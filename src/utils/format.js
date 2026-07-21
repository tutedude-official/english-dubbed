function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return fmtDuration(ms);
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

function timestamp() {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

module.exports = { fmtDuration, fmtMs, fmtTime, timestamp };
