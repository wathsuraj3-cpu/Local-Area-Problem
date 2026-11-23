const readline = require("readline");
const crypto = require("crypto");
const db = require("./db");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  try {
    if (db.users().some((u) => u.role === "admin")) {
      throw new Error("An administrator already exists.");
    }

    const name = (await ask("Administrator full name: ")).trim();
    const email = (await ask("Administrator email: "))
      .trim()
      .toLowerCase();
    const password = await ask("Set administrator password (minimum 10 characters): ");

    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
      throw new Error("Invalid details. Password must be at least 10 characters.");
    }

    if (db.userByEmail(email)) {
      throw new Error("An account with this email already exists.");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");

    const user = {
      id: "ADM-" + crypto.randomBytes(8).toString("hex"),
      name,
      email,
      phone: "",
      passwordHash: { salt, hash },
      role: "admin",
      createdAt: new Date().toISOString(),
    };

    db.addUser(user);
    console.log(`\nAdmin account created successfully for ${email}.`);
  } catch (e) {
    console.error("\nError:", e.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
})();
