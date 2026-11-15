/** Pure idempotency guards used by payment activation and background workers. */
export function shouldStartAutoGeneration(order: Record<string, unknown>, hasGenerator: boolean): boolean {
  return order['source'] === 'auto'
    && !order['sunor_task_id']
    && !order['kie_task_id']
    && !order['sunorStartRequested']
    && Number(order['generationRetryCount'] ?? 0) < 8
    && hasGenerator;
}

/** A failed Resend attempt must remain retryable; a true flag is the receipt. */
export function shouldRetryDeliveryEmail(order: Record<string, unknown>, hasResend: boolean): boolean {
  return order['treblo_status'] === 'success'
    && order['deliveryEmailSent'] !== true
    && hasResend
    && Boolean(order['email']);
}
