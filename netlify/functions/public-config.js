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

exports.handler = async () => {
  return json(200, {
    siteUrl: process.env.BORIMC_NETLIFY_SITE_URL || "https://borisurvur.netlify.app",
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || "",
    recaptchaVersion: process.env.RECAPTCHA_VERSION || "v2"
  });
};
