const crypto = require("crypto");

class StorageHelper {
  getExtensionFromContentType(contentType, fallback = "jpg") {
    const raw = String(contentType || "").toLowerCase();
    if (raw.includes("png")) return "png";
    if (raw.includes("webp")) return "webp";
    if (raw.includes("gif")) return "gif";
    if (raw.includes("jpeg") || raw.includes("jpg")) return "jpg";
    return fallback;
  }

  normalizeDateOfBirth(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const match = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }

    return "";
  }

  buildStorageObjectName(accountId, originalName, fallbackExt = "bin") {
    const extRaw = String(originalName || "").split(".").pop() || fallbackExt;
    const ext = extRaw.toLowerCase();
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `${accountId}/${ts}_${crypto.randomUUID().replace(/-/g, "")}.${ext}`;
  }

  async createSignedUrlSafe(supabaseClient, bucket, objectPath) {
    const safePath = String(objectPath || "").trim();
    if (!safePath) return null;
    try {
      const signed = await supabaseClient.storage.from(bucket).createSignedUrl(safePath, 3600);
      if (signed.error) return null;
      return signed.data?.signedUrl || null;
    } catch (err) {
      return null;
    }
  }
}

module.exports = StorageHelper;
