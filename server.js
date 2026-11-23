const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const ai = require("./ai");
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET =
  process.env.SESSION_SECRET ||
  "change-this-session-secret-before-deployment-" +
    crypto.randomBytes(16).toString("hex");
const sessions = new Map();
app.disable("x-powered-by");
app.set("trust proxy", 1); // hosting platforms terminate https in front of the app
app.use(express.json({ limit: "7mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public")));
const hashPassword = (
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") });
const verifyPassword = (password, stored) => {
  if (!stored?.salt || !stored?.hash) return false;
  const actual = crypto.scryptSync(password, stored.salt, 64);
  const expected = Buffer.from(stored.hash, "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
};
const cookieName = "lapr_session";
function setSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  const sig = crypto.createHmac("sha256", SECRET).update(token).digest("hex");
  sessions.set(token, {
    userId: user.id,
    role: user.role,
    expires: Date.now() + 8 * 60 * 60 * 1000,
  });
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}.${sig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}
function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
function currentUser(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!raw) return null;
  const [token, sig] = raw.split(".");
  if (!token || !sig) return null;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(token)
    .digest("hex");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return db.users().find((u) => u.id === s.userId) || null;
}
function requireAuth(req, res, next) {
  req.user = currentUser(req);
  if (!req.user)
    return res
      .status(401)
      .json({ success: false, error: "Please sign in to continue." });
  next();
}
function requireAdmin(req, res, next) {
  req.user = currentUser(req);
  if (!req.user || req.user.role !== "admin")
    return res
      .status(403)
      .json({ success: false, error: "Administrator access required." });
  next();
}
const num = (x) =>
  x === "" || x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x);
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    role: u.role,
    createdAt: u.createdAt,
  };
}
app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    status: "ok",
    service: "Local Area Problem Reporter",
  }),
);
app.get("/api/auth/me", (req, res) => {
  const u = currentUser(req);
  res.json({ success: true, user: u ? publicUser(u) : null });
});
app.post("/api/auth/register", (req, res) => {
  const { name, email, password, phone = "" } = req.body || {};
  if (
    !name?.trim() ||
    !email?.trim() ||
    typeof password !== "string" ||
    password.length < 8
  )
    return res
      .status(400)
      .json({
        success: false,
        error:
          "Enter your name, a valid email and a password of at least 8 characters.",
      });
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    return res
      .status(400)
      .json({ success: false, error: "Enter a valid email address." });
  if (db.userByEmail(normalized))
    return res
      .status(409)
      .json({
        success: false,
        error: "This email is already registered. Please sign in.",
      });
  const p = hashPassword(password);
  const user = {
    id: "USR-" + crypto.randomBytes(8).toString("hex"),
    name: name.trim().slice(0, 80),
    email: normalized,
    phone: String(phone).trim().slice(0, 20),
    passwordHash: p,
    role: "citizen",
    createdAt: new Date().toISOString(),
  };
  db.addUser(user);
  setSession(res, user);
  res.status(201).json({ success: true, user: publicUser(user) });
});
app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "")
      .trim()
      .toLowerCase(),
    password = String(req.body?.password || "");
  const user = db.userByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash))
    return res
      .status(401)
      .json({ success: false, error: "Email or password is incorrect." });
  setSession(res, user);
  res.json({ success: true, user: publicUser(user) });
});
app.post("/api/auth/logout", (req, res) => {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (raw) sessions.delete(raw.split(".")[0]);
  clearSession(res);
  res.json({ success: true });
});
app.get("/api/reports", requireAuth, (req, res) => {
  const all = db.reports();
  const reports =
    req.user.role === "admin"
      ? all
      : all.filter((r) => r.citizenId === req.user.id);
  res.json({ success: true, count: reports.length, reports });
});
app.get("/api/reports/:id", requireAuth, (req, res) => {
  const report = db.reports().find((r) => r.id === req.params.id);
  if (!report)
    return res
      .status(404)
      .json({ success: false, error: "Report not found." });
  if (req.user.role !== "admin" && report.citizenId !== req.user.id)
    return res
      .status(403)
      .json({ success: false, error: "You can only view your own reports." });
  res.json({
    success: true,
    report,
    audit: db.audit().filter((a) => a.reportId === report.id),
  });
});
app.post("/api/ai/analyze-text", requireAuth, (req, res) => {
  const { title = "", description = "" } = req.body || {};
  const analysis = ai.analyzeText(String(title).slice(0, 120), String(description).slice(0, 2000));
  const similar = ai.findDuplicates(
    { title, description, location: String(req.body?.location || "") },
    db.reports(),
  ).length;
  // Citizens only receive the number of similar open reports (no other user's data).
  res.json({ success: true, analysis, similarOpenReports: similar });
});
app.post("/api/reports", requireAuth, (req, res) => {
  const {
    title,
    category,
    description,
    location,
    imageData,
    imageName,
    latitude,
    longitude,
    locationAccuracy,
    imageAnalysis,
  } = req.body || {};
  if (
    !title?.trim() ||
    !category ||
    !description?.trim() ||
    !location?.trim()
  )
    return res
      .status(400)
      .json({
        success: false,
        error: "Category, title, description and location are required.",
      });
  if (
    imageData &&
    (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(imageData) ||
      imageData.length > 5 * 1024 * 1024 ||
      !ai.isRealImage(imageData))
  )
    return res
      .status(400)
      .json({
        success: false,
        error: "Upload a valid JPG, PNG or WEBP image smaller than 3.5 MB.",
      });
  const text = ai.analyzeText(title, description);
  const duplicates = ai.findDuplicates(
    { title, description, location },
    db.reports(),
  );
  const now = new Date().toISOString();
  const report = {
    id:
      "LAPR-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(2).toString("hex").toUpperCase(),
    title: title.trim().slice(0, 120),
    category: String(category).slice(0, 40),
    description: description.trim().slice(0, 2000),
    location: location.trim().slice(0, 300),
    imageData: imageData || "",
    imageName: String(imageName || "").slice(0, 120),
    latitude: num(latitude),
    longitude: num(longitude),
    locationAccuracy: num(locationAccuracy),
    citizenId: req.user.id,
    citizenName: req.user.name,
    citizenEmail: req.user.email,
    status: "Pending",
    priority: text.priority,
    ai: {
      text,
      image: imageData ? ai.cleanImageAnalysis(imageAnalysis) : null,
      duplicates,
      categoryMismatch:
        text.confidence >= 0.6 && text.category !== String(category),
    },
    resolutionEvidence: null,
    adminRemarks: "Your report has been received and is awaiting review.",
    createdAt: now,
    updatedAt: now,
  };
  db.addReport(report);
  res.status(201).json({ success: true, report });
});
app.patch("/api/reports/:id", requireAdmin, (req, res) => {
  const allowed = ["status", "priority", "adminRemarks", "assignedTo"];
  const changes = {};
  for (const k of allowed)
    if (req.body?.[k] !== undefined)
      changes[k] = String(req.body[k]).slice(0, 1000);
  if (
    changes.status &&
    !["Pending", "In Progress", "Resolved", "Rejected"].includes(
      changes.status,
    )
  )
    return res
      .status(400)
      .json({ success: false, error: "Invalid report status." });
  const current = db.reports().find((r) => r.id === req.params.id);
  if (!current)
    return res
      .status(404)
      .json({ success: false, error: "Report not found." });
  if (changes.status === "Resolved" && !current.resolutionEvidence)
    return res.status(400).json({
      success: false,
      error:
        "Upload resolution evidence (an after-work photo) before marking the report as Resolved.",
    });
  const updated = db.updateReport(req.params.id, changes, req.user.name);
  res.json({ success: true, report: updated });
});
app.post("/api/reports/:id/evidence", requireAdmin, (req, res) => {
  const { imageData, imageName, note, similarity, latitude, longitude } = req.body || {};
  const current = db.reports().find((r) => r.id === req.params.id);
  if (!current)
    return res
      .status(404)
      .json({ success: false, error: "Report not found." });
  if (
    !imageData ||
    !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(imageData) ||
    imageData.length > 5 * 1024 * 1024 ||
    !ai.isRealImage(imageData)
  )
    return res.status(400).json({
      success: false,
      error: "Upload a valid JPG, PNG or WEBP evidence photo smaller than 3.5 MB.",
    });
  const sim = Number(similarity);
  const hasPos =
    latitude !== undefined && longitude !== undefined &&
    latitude !== "" && longitude !== "" &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  const lat = hasPos ? Number(latitude) : null,
    lon = hasPos ? Number(longitude) : null;
  const evidence = {
    latitude: lat,
    longitude: lon,
    distanceMeters:
      hasPos && current.latitude != null && current.longitude != null
        ? Math.round(distanceMeters(current.latitude, current.longitude, lat, lon))
        : null,
    imageData,
    imageName: String(imageName || "").slice(0, 120),
    note: String(note || "").trim().slice(0, 500),
    aiSimilarity: Number.isFinite(sim) ? Math.min(1, Math.max(0, sim)) : null,
    uploadedBy: req.user.name,
    uploadedAt: new Date().toISOString(),
  };
  const updated = db.updateReport(
    req.params.id,
    { resolutionEvidence: evidence },
    req.user.name,
    "EVIDENCE_UPLOADED",
  );
  res.json({ success: true, report: updated });
});
app.delete("/api/reports/:id", requireAdmin, (req, res) => {
  if (!db.deleteReport(req.params.id))
    return res
      .status(404)
      .json({ success: false, error: "Report not found." });
  res.json({ success: true });
});
app.get("/api/stats", requireAdmin, (req, res) => {
  const r = db.reports();
  res.json({
    success: true,
    stats: {
      total: r.length,
      pending: r.filter((x) => x.status === "Pending").length,
      inProgress: r.filter((x) => x.status === "In Progress").length,
      resolved: r.filter((x) => x.status === "Resolved").length,
    },
  });
});
app.get("/api/export/csv", requireAdmin, (req, res) => {
  const rows = [
    [
      "Report ID",
      "Date",
      "Category",
      "Title",
      "Status",
      "Location",
      "Citizen",
      "Email",
      "Remarks",
      "Priority",
      "AI Suggested Category",
      "Resolution Evidence",
    ],
    ...db
      .reports()
      .map((r) => [
        r.id,
        r.createdAt,
        r.category,
        r.title,
        r.status,
        r.location,
        r.citizenName,
        r.citizenEmail,
        r.adminRemarks,
        r.priority,
        r.ai?.text?.category || "",
        r.resolutionEvidence ? "Yes" : "No",
      ]),
  ];
  const csv = rows
    .map((row) =>
      row
        .map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"')
        .join(","),
    )
    .join("\r\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="local-area-problem-reports.csv"',
  );
  res.send(csv);
});
app.get("/api/admin/ready", (req, res) => {
  const admins = db.users().filter((u) => u.role === "admin").length;
  res.json({ success: true, configured: admins > 0 });
});
app.get("/admin-login.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-login.html")),
);
app.get("/admin.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html")),
);
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: "Unexpected server error." });
});
// Optional: create the administrator automatically on first start (hosted environments
// without a command line). Set ADMIN_EMAIL, ADMIN_PASSWORD (10+ chars) and ADMIN_NAME.
(function bootstrapAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) return;
  if (db.users().some((u) => u.role === "admin")) return;
  db.addUser({
    id: "ADM-" + crypto.randomBytes(8).toString("hex"),
    name: (ADMIN_NAME || "Administrator").slice(0, 80),
    email: ADMIN_EMAIL.trim().toLowerCase(),
    phone: "",
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  console.log("Administrator account created from environment variables.");
})();
app.listen(PORT, "0.0.0.0", () => {
  const os = require("os");
  console.log(`Local Area Problem Reporter is running on port ${PORT}`);
  const pub = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (pub) console.log(`Public link : ${pub}`);
  console.log(`This computer: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === "IPv4" && !n.internal)
        console.log(`Same Wi-Fi (phones/other PCs): http://${n.address}:${PORT}`);
});
