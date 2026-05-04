class DateTimeHelper {
  computeElapsedSeconds(startIso, endIso) {
    const startMs = Date.parse(String(startIso || ""));
    const endMs = Date.parse(String(endIso || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
    return Math.round((endMs - startMs) / 1000);
  }
}

module.exports = DateTimeHelper;
