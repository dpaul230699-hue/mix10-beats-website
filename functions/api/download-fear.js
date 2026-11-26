
function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({
    alg: "RS256",
    typ: "JWT"
  }));

  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));

  const unsignedToken = `${header}.${claim}`;

  const pem = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(pem);
  const keyBytes = Uint8Array.from(binary, c => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  let signatureBinary = "";
  for (const byte of new Uint8Array(signature)) {
    signatureBinary += String.fromCharCode(byte);
  }

  const assertion =
    `${unsignedToken}.${btoa(signatureBinary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")}`;

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    }
  );

  if (!tokenResponse.ok) {
    throw new Error("Google authentication failed");
  }

  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    throw new Error("Google access token unavailable");
  }

  return tokenData.access_token;
}

export async function onRequestGet({ request, env }) {
  try {
    if (
      !env.DB ||
      !env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      !env.FEAR_DRIVE_FILE_ID
    ) {
      return new Response("Download service unavailable", {
        status: 503
      });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (
      !token ||
      !/^[a-f0-9]{64}$/i.test(token)
    ) {
      return new Response("Invalid download link", {
        status: 400
      });
    }

    const now = Math.floor(Date.now() / 1000);

    // Check eligibility without consuming a download attempt.
const record = await env.DB.prepare(
  `SELECT payment_id, expires_at, download_count
   FROM fear_downloads
   WHERE download_token = ?
   AND expires_at > ?
   AND download_count < 3`
).bind(token, now).first();

if (!record) {
  return new Response(
    "Download link invalid, expired, or limit reached",
    { status: 403 }
  );
}

    const serviceAccount = JSON.parse(
      env.GOOGLE_SERVICE_ACCOUNT_JSON
    );

    const accessToken =
      await getGoogleAccessToken(serviceAccount);

    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(env.FEAR_DRIVE_FILE_ID)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!driveResponse.ok || !driveResponse.body) {
      return new Response("Installer delivery failed", {
        status: 502
      });
    }

    // Count only when Google Drive is ready.
const countUpdate = await env.DB.prepare(
  `UPDATE fear_downloads
   SET download_count = download_count + 1
   WHERE download_token = ?
   AND expires_at > ?
   AND download_count < 3`
).bind(token, now).run();

if (!countUpdate.meta || countUpdate.meta.changes !== 1) {
  return new Response("Download limit reached or link expired", {
    status: 403
  });
}
    const headers = new Headers({
      "Content-Type": "application/vnd.rar",
      "Content-Disposition": 'attachment; filename="FEAR_3.0.rar"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    });

    const contentLength =
      driveResponse.headers.get("Content-Length");

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(driveResponse.body, {
      status: 200,
      headers
    });

  } catch (error) {
    return new Response("Secure download service error", {
      status: 500
    });
  }
}
