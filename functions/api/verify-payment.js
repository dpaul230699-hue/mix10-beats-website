
export async function onRequestPost({ request, env }) {
  try {
    if (
      !env.RAZORPAY_KEY_ID ||
      !env.RAZORPAY_KEY_SECRET ||
      !env.DB
    ) {
      return Response.json(
        { verified: false, error: "Server configuration incomplete" },
        { status: 500 }
      );
    }

    const body = await request.json();

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = body;

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(razorpay_signature)
    ) {
      return Response.json(
        { verified: false, error: "Invalid payment details" },
        { status: 400 }
      );
    }

    // Verify Razorpay signature
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.RAZORPAY_KEY_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
    );

    const expected = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    let difference = 0;

    for (let i = 0; i < expected.length; i++) {
      difference |=
        expected.charCodeAt(i) ^
        razorpay_signature.toLowerCase().charCodeAt(i);
    }

    if (difference !== 0) {
      return Response.json(
        { verified: false, error: "Signature verification failed" },
        { status: 400 }
      );
    }

    // Confirm payment directly with Razorpay
    const auth = btoa(
      `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const headers = {
      Authorization: `Basic ${auth}`
    };

    const orderResponse = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpay_order_id)}`,
      { headers }
    );

    if (!orderResponse.ok) {
      return Response.json(
        { verified: false, error: "Unable to confirm order" },
        { status: 400 }
      );
    }

    const order = await orderResponse.json();

    const paymentResponse = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`,
      { headers }
    );

    if (!paymentResponse.ok) {
      return Response.json(
        { verified: false, error: "Unable to confirm payment" },
        { status: 400 }
      );
    }

    const payment = await paymentResponse.json();

    const valid =
      order.id === razorpay_order_id &&
      order.amount === 99900 &&
      order.currency === "INR" &&
      order.status === "paid" &&
      typeof order.receipt === "string" &&
      order.receipt.startsWith("fear_") &&
      payment.id === razorpay_payment_id &&
      payment.order_id === razorpay_order_id &&
      payment.status === "captured" &&
      payment.amount === 99900 &&
      payment.currency === "INR";

    if (!valid) {
      return Response.json(
        { verified: false, error: "Payment not confirmed" },
        { status: 400 }
      );
    }

    // Test payments are verified but never receive downloads
    if (env.RAZORPAY_MODE !== "live") {
      return Response.json({
        verified: true,
        test_mode: true,
        download_url: null,
        message: "Test payment verified. No download has been issued."
      });
    }

    // Create or reuse a purchase record for a live payment
    const existing = await env.DB.prepare(
      "SELECT order_id, download_token, expires_at FROM fear_downloads WHERE payment_id = ?"
    ).bind(razorpay_payment_id).first();

    if (existing) {
      if (existing.order_id !== razorpay_order_id) {
        return Response.json(
          { verified: false, error: "Payment record mismatch" },
          { status: 409 }
        );
      }

      if (!existing.download_token || existing.expires_at <= Math.floor(Date.now() / 1000)) {
        return Response.json(
          { verified: false, error: "Download access has expired" },
          { status: 410 }
        );
      }

      return Response.json({
        verified: true,
        test_mode: false,
        download_url: `/api/download-fear?token=${encodeURIComponent(existing.download_token)}`,
        expires_at: existing.expires_at
      });
    }

    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const downloadToken = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (48 * 60 * 60);

    await env.DB.prepare(
      `INSERT INTO fear_downloads
       (payment_id, order_id, redeemed_at, expires_at, download_count, download_token)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).bind(
      razorpay_payment_id,
      razorpay_order_id,
      now,
      expiresAt,
      downloadToken
    ).run();

    return Response.json({
      verified: true,
      test_mode: false,
      download_url: `/api/download-fear?token=${encodeURIComponent(downloadToken)}`,
      expires_at: expiresAt,
      message: "FEAR 3.0 payment verified"
    });

  } catch (error) {
    return Response.json(
      { verified: false, error: "Server error" },
      { status: 500 }
    );
  }
}
