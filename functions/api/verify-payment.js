
export async function onRequestPost({ request, env }) {
  try {
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
        { verified: false },
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
        { verified: false },
        { status: 400 }
      );
    }

    const payment = await paymentResponse.json();

    const valid =
      order.amount === 99900 &&
      order.currency === "INR" &&
      order.status === "paid" &&
      order.receipt?.startsWith("fear_") &&
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

    return Response.json({
      verified: true,
      message: "FEAR 3.0 payment verified"
    });

  } catch (error) {
    return Response.json(
      { verified: false, error: "Server error" },
      { status: 500 }
    );
  }
}
