const crypto = require("crypto");

const DEFAULT_API_URL = "https://borimc.p-e.kr";
const MAX_BODY_BYTES = 12 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value || ""), "utf8").digest("hex");
}

function requestIp(event) {
  const headers = event.headers || {};
  const raw = headers["x-nf-client-connection-ip"]
    || headers["X-Nf-Client-Connection-Ip"]
    || headers["client-ip"]
    || headers["Client-Ip"]
    || headers["x-forwarded-for"]
    || headers["X-Forwarded-For"]
    || "";
  return String(raw).split(",")[0].trim();
}

function hashContext(event) {
  const secret = process.env.BORIMC_IP_HASH_SECRET
    || process.env.BORIMC_BUG_REPORT_SECRET
    || process.env.BORIMC_STATUS_SECRET
    || "borimc-development-hash-secret";
  const headers = event.headers || {};
  const userAgent = headers["user-agent"] || headers["User-Agent"] || "";
  const ip = requestIp(event);

  return {
    ipHash: hmacSha256Hex(secret, ip).slice(0, 64),
    userAgentHash: hmacSha256Hex(secret, userAgent).slice(0, 64)
  };
}

function parseJsonBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { error: json(413, { ok: false, status: "REQUEST_TOO_LARGE", message: "요청이 너무 큽니다." }) };
  }

  try {
    return { body: JSON.parse(rawBody || "{}") };
  } catch {
    return { error: json(400, { ok: false, status: "BAD_JSON", message: "요청 형식이 올바르지 않습니다." }) };
  }
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function forwardToApi(payload) {
  const baseUrl = (process.env.BORIMC_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  const token = process.env.BORIMC_BUG_REPORT_SECRET
    || process.env.BORIMC_REGISTRATION_SECRET
    || process.env.BORIMC_STATUS_SECRET
    || "";

  if (!token) return null;

  const response = await fetch(`${baseUrl}/bug-reports`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "BoriMC-Netlify-BugReport/1.0"
    },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return {
    ok: response.ok,
    status: data.status || response.status,
    message: data.message || (response.ok ? "버그 제보가 접수되었습니다." : "BoriMC API 제보 접수에 실패했습니다.")
  };
}

async function forwardToDiscord(payload) {
  const webhookUrl = process.env.BORIMC_BUG_REPORT_WEBHOOK || "";
  if (!webhookUrl) return null;

  const content = [
    "[BoriMC 버그 제보]",
    `분류: ${payload.category}`,
    `제보자: ${payload.reporter}`,
    `위치: ${payload.location || "-"}`,
    `내용: ${payload.description}`,
    `IP Hash: ${payload.requestContext.ipHash.slice(0, 12)}...`
  ].join("\n");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BoriMC-Netlify-BugReport/1.0"
    },
    body: JSON.stringify({ content })
  });

  return {
    ok: response.ok,
    status: response.status,
    message: response.ok ? "버그 제보가 운영진 채널로 전송되었습니다." : "디스코드 제보 전송에 실패했습니다."
  };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  const contentType = String((event.headers || {})["content-type"] || (event.headers || {})["Content-Type"] || "");

  if (method !== "POST") {
    return json(405, { ok: false, status: "METHOD_NOT_ALLOWED", message: "POST 요청만 허용됩니다." });
  }
  if (!contentType.includes("application/json")) {
    return json(415, { ok: false, status: "UNSUPPORTED_MEDIA_TYPE", message: "JSON 요청만 허용됩니다." });
  }

  const parsed = parseJsonBody(event);
  if (parsed.error) return parsed.error;

  const body = parsed.body;
  const payload = {
    category: cleanText(body.category, 40) || "버그",
    reporter: cleanText(body.reporter, 80),
    location: cleanText(body.location, 120),
    description: cleanText(body.description, 1500),
    requestContext: hashContext(event),
    createdAt: new Date().toISOString()
  };

  if (!payload.reporter || !payload.description) {
    return json(400, {
      ok: false,
      status: "INVALID_FORM",
      message: "마크닉/디스코드닉과 제보 내용을 입력해 주세요."
    });
  }

  try {
    const apiResult = await forwardToApi(payload);
    if (apiResult && apiResult.ok) {
      return json(200, { ok: true, status: "ACCEPTED", message: apiResult.message });
    }

    const discordResult = await forwardToDiscord(payload);
    if (discordResult && discordResult.ok) {
      return json(200, { ok: true, status: "ACCEPTED", message: discordResult.message });
    }

    return json(500, {
      ok: false,
      status: "BUG_REPORT_NOT_CONFIGURED",
      message: "버그 제보 서버 설정이 아직 완료되지 않았습니다. 디스코드로 운영진에게 알려 주세요."
    });
  } catch {
    return json(502, {
      ok: false,
      status: "BUG_REPORT_FAILED",
      message: "버그 제보 전송에 실패했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
};
