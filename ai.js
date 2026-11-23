"use strict";

const CATEGORIES = [
  "Road Damage",
  "Streetlight",
  "Garbage",
  "Water Leakage",
  "Drainage",
  "Other"
];

const WORDS = {
  "Road Damage": ["pothole", "road", "roads", "crack", "broken road", "damaged road"],
  "Streetlight": ["streetlight", "street light", "light", "lamp", "dark lane", "electric light"],
  "Garbage": ["garbage", "waste", "rubbish", "trash", "litter", "bad smell"],
  "Water Leakage": ["water", "leak", "leaking", "pipe", "pipeline", "burst pipe"],
  "Drainage": ["drain", "drainage", "sewage", "blocked drain", "overflowing", "manhole"]
};

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function analyzeText(title = "", description = "") {
  const text = normalize(title + " " + description);
  let best = "Other";
  let highest = 0;

  for (const [category, keywords] of Object.entries(WORDS)) {
    let score = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        score += keyword.includes(" ") ? 3 : 2;
      }
    }

    if (score > highest) {
      highest = score;
      best = category;
    }
  }

  const confidence = highest === 0
    ? 0
    : Math.min(0.99, 0.55 + highest * 0.06);

  const priority = predictPriority(text).priority;

  return {
    category: best,
    confidence,
    priority,
    keywordsFound: highest
  };
}

function predictPriority(value = "") {
  const text = normalize(value);

  const critical = [
    "fire", "electrocution", "live wire", "electric shock",
    "collapsed", "building collapse", "life threatening"
  ];

  const high = [
    "danger", "accident", "injury", "emergency",
    "children", "fallen wire", "flood", "overflowing",
    "open manhole", "contaminated"
  ];

  if (critical.some(w => text.includes(w))) {
    return { priority: "Critical", confidence: 0.95 };
  }

  if (high.some(w => text.includes(w))) {
    return { priority: "High", confidence: 0.85 };
  }

  return { priority: "Normal", confidence: 0.7 };
}

function tokens(value) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter(w => w.length > 2)
  );
}

function similarity(a, b) {
  const intersection = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function findDuplicates(report = {}, reports = []) {
  const incoming = tokens(
    report.title + " " + report.description
  );

  return reports.filter(existing => {
    if (String(existing.status || "").toLowerCase() === "resolved") {
      return false;
    }

    const existingTokens = tokens(
      existing.title + " " + existing.description
    );

    const textSimilarity = similarity(incoming, existingTokens);
    const locationMatch =
      normalize(report.location) &&
      normalize(report.location) === normalize(existing.location);

    return textSimilarity >= 0.25 ||
      (locationMatch && textSimilarity >= 0.15);
  });
}

function isRealImage(imageData) {
  if (typeof imageData !== "string") return false;

  const match = imageData.match(
    /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/
  );

  if (!match) return false;

  try {
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length < 12 || buffer.length > 4 * 1024 * 1024) {
      return false;
    }

    const mime = match[1];

    if (mime === "png") {
      return buffer.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );
    }

    if (mime === "jpg" || mime === "jpeg") {
      return buffer[0] === 0xFF &&
        buffer[1] === 0xD8 &&
        buffer[2] === 0xFF;
    }

    if (mime === "webp") {
      return buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    }

    return false;
  } catch {
    return false;
  }
}

function cleanImageAnalysis(value = {}) {
  const label = String(value.label || "").slice(0, 80);

  const confidence = Number.isFinite(Number(value.confidence))
    ? Math.max(0, Math.min(1, Number(value.confidence)))
    : 0;

  const suggestedCategory = CATEGORIES.includes(value.suggestedCategory)
    ? value.suggestedCategory
    : "";

  return {
    label,
    confidence,
    suggestedCategory
  };
}

module.exports = {
  analyzeText,
  predictPriority,
  findDuplicates,
  isRealImage,
  cleanImageAnalysis
};
