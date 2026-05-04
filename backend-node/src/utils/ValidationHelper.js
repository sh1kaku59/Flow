class ValidationHelper {
  isValidUuid(value) {
    return typeof value === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
  }

  isRlsInsertError(err) {
    const message = String(err?.message || "").toLowerCase();
    return message.includes("row-level security") || message.includes("violates row-level security policy");
  }

  isMissingSummaryStorageError(err) {
    const message = String(err?.message || "").toLowerCase();
    return (message.includes("column") && message.includes("summary")) || message.includes("schema cache");
  }

  parseEmbedding(value) {
    if (Array.isArray(value)) {
      const arr = value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      return arr.length ? arr : null;
    }

    if (typeof value === "string") {
      const raw = value.trim();
      if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const out = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x));
            return out.length ? out : null;
          }
        } catch (err) {
          const inner = raw.slice(1, -1).trim();
          if (!inner) return null;
          const out = inner
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((x) => Number.isFinite(x));
          return out.length ? out : null;
        }
      }
    }

    return null;
  }

  computeCosineSimilarity(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
      return -1;
    }

    let dot = 0;
    let normLeft = 0;
    let normRight = 0;
    for (let i = 0; i < left.length; i += 1) {
      const x = Number(left[i]);
      const y = Number(right[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return -1;
      }
      dot += x * y;
      normLeft += x * x;
      normRight += y * y;
    }

    const denom = Math.sqrt(normLeft) * Math.sqrt(normRight);
    if (!Number.isFinite(denom) || denom <= 0) {
      return -1;
    }
    return dot / denom;
  }

  toPgvectorLiteral(vector) {
    return `[${vector.map((x) => Number(x).toFixed(8)).join(",")}]`;
  }
}

module.exports = ValidationHelper;
