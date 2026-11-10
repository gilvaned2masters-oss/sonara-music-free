export interface MpPixResult {
  ok: boolean;
  mpPaymentId?: string;
  payload?: string;       // PIX copia e cola
  encodedImage?: string;  // base64 QR Code
  error?: string;
}

export async function createMpPixPayment(
  accessToken: string,
  params: {
    amount: number;
    email: string;
    name: string;
    cpf: string;
    description: string;
    externalRef: string;
  }
): Promise<MpPixResult> {
  const nameParts = params.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? 'Cliente';
  const lastName  = nameParts.slice(1).join(' ') || firstName;

  const body = {
    transaction_amount: Number(params.amount.toFixed(2)),
    description: params.description.slice(0, 255),
    payment_method_id: 'pix',
    external_reference: params.externalRef,
    payer: {
      email: params.email,
      first_name: firstName,
      last_name: lastName,
      identification: {
        type: 'CPF',
        number: params.cpf.replace(/\D/g, ''),
      },
    },
  };

  try {
    const res = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': params.externalRef,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return { ok: false, error: JSON.stringify(data) };
    }

    const txData = (data['point_of_interaction'] as Record<string, unknown>)?.['transaction_data'] as Record<string, unknown> | undefined;

    return {
      ok: true,
      mpPaymentId: String(data['id'] ?? ''),
      payload: String(txData?.['qr_code'] ?? ''),
      encodedImage: String(txData?.['qr_code_base64'] ?? ''),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getMpPaymentStatus(accessToken: string, mpPaymentId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    });
    if (!res.ok) return 'unknown';
    const data = await res.json() as Record<string, unknown>;
    return String(data['status'] ?? 'unknown'); // approved | pending | rejected
  } catch {
    return 'unknown';
  }
}
