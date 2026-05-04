const crypto = require("crypto");

class CryptoHelper {
  async hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const digest = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        return resolve(derivedKey.toString("hex"));
      });
    });
    return `scrypt$${salt}$${digest}`;
  }
}

module.exports = CryptoHelper;
