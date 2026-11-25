export async function onRequestPost({ request, env }) {
  try {
    const auth = btoa(
      `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const response = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: 99900,
          currency: "INR",
          receipt: `fear_${crypto.randomUUID()}`
        })
      }
    );

    const order = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: "Unable to create payment order" },
        { status: 400 }
      );
    }

    return Response.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env.RAZORPAY_KEY_ID
    });
  } catch {
    return Response.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
