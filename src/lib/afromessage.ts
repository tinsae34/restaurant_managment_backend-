import { prisma } from './prisma.js';
import { normalizeEthiopianPhone } from './phone.js';

export interface SendSmsParams {
  to: string;
  message: string;
  triggerType?: 'ORDER_CONFIRMATION' | 'ORDER_READY' | 'BROADCAST' | 'MANUAL';
  orderId?: string;
}

export interface SmsResult {
  success: boolean;
  status: 'DELIVERED' | 'SENT_SIMULATED' | 'FAILED';
  recipient: string;
  simulated: boolean;
  responseData?: any;
  error?: string;
}

export async function sendSms({
  to,
  message,
  triggerType = 'MANUAL',
  orderId,
}: SendSmsParams): Promise<SmsResult> {
  const normalizedPhone = normalizeEthiopianPhone(to);
  const token = process.env.AFROMESSAGE_API_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJpZGVudGlmaWVyIjoiU2xKaEVpdFNLNzFlaG9UcnY5WEFCY0NSSk5ieklvcmwiLCJleHAiOjE5MDkyNDkwMDYsImlhdCI6MTc1MTQ4MjYwNiwianRpIjoiNjNkMDhlMjAtYjJiZC00NTFhLWJmZTItZjllOTY1NGM0ZDFjIn0.tZdEa1p19HZ9q_WuhSI9tDDeeKlHlOvDqgT5rl1S39o';
  const identifier = process.env.AFROMESSAGE_IDENTIFIER || 'e80ad9d8-adf3-463f-80f4-7c4b39f7f164';
  const senderName = process.env.AFROMESSAGE_SENDER_NAME || 'Tolo ET';

  // Check if token is present and not default placeholder
  const isLiveConfig = Boolean(
    token &&
    token.trim() !== '' &&
    !token.includes('mock') &&
    !token.includes('YOUR_AFROMESSAGE')
  );

  console.log(`[AfroMessage] Dispatching SMS to ${normalizedPhone} (Mode: ${isLiveConfig ? 'LIVE' : 'SIMULATED'})`);

  if (!isLiveConfig) {
    // Simulated delivery for testing/development
    console.log(`[AfroMessage MOCK] Body: "${message}"`);

    // Save to DB
    const log = await prisma.smsLog.create({
      data: {
        recipient: normalizedPhone,
        message,
        status: 'SENT_SIMULATED',
        triggerType,
        orderId,
        responseData: JSON.stringify({
          simulated: true,
          timestamp: new Date().toISOString(),
          note: 'Sent via Simulated AfroMessage Sandbox'
        }),
      },
    });

    return {
      success: true,
      status: 'SENT_SIMULATED',
      recipient: normalizedPhone,
      simulated: true,
      responseData: { logId: log.id, simulated: true }
    };
  }

  // Live AfroMessage API Call
  try {
    const formattedPhone = normalizedPhone.startsWith('+') ? normalizedPhone : `+${normalizedPhone}`;

    const payload: Record<string, any> = {
      to: formattedPhone,
      message: message,
    };

    // Only include identifier and sender if explicitly set and non-empty
    if (identifier && identifier.trim() !== '') {
      payload.from = identifier.trim();
    }
    if (senderName && senderName.trim() !== '') {
      payload.sender = senderName.trim();
    }

    const response = await fetch('https://api.afromessage.com/api/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({ status: response.statusText }));
    const isSuccess = response.ok && responseData?.acknowledge === 'success';

    if (isSuccess) {
      console.log(`[AfroMessage Success] Sent to ${formattedPhone}. Message ID: ${responseData?.response?.message_id || 'N/A'}`);
      await prisma.smsLog.create({
        data: {
          recipient: formattedPhone,
          message,
          status: 'DELIVERED',
          triggerType,
          orderId,
          responseData: JSON.stringify(responseData),
        },
      });

      return {
        success: true,
        status: 'DELIVERED',
        recipient: formattedPhone,
        simulated: false,
        responseData,
      };
    } else {
      const errorMsg =
        (Array.isArray(responseData?.response?.errors) ? responseData.response.errors.join('; ') : null) ||
        responseData?.response?.errors ||
        responseData?.message ||
        responseData?.error ||
        `AfroMessage returned status: ${response.status} ${response.statusText}`;

      console.error(`[AfroMessage Error] Failed to send to ${formattedPhone}: ${errorMsg}`, responseData);

      await prisma.smsLog.create({
        data: {
          recipient: formattedPhone,
          message,
          status: 'FAILED',
          triggerType,
          orderId,
          responseData: JSON.stringify(responseData),
        },
      });

      return {
        success: false,
        status: 'FAILED',
        recipient: formattedPhone,
        simulated: false,
        responseData,
        error: errorMsg,
      };
    }
  } catch (err: any) {
    console.error('[AfroMessage Network Error]', err);
    const formattedPhone = normalizedPhone.startsWith('+') ? normalizedPhone : `+${normalizedPhone}`;
    await prisma.smsLog.create({
      data: {
        recipient: formattedPhone,
        message,
        status: 'FAILED',
        triggerType,
        orderId,
        responseData: JSON.stringify({ error: err.message }),
      },
    });

    return {
      success: false,
      status: 'FAILED',
      recipient: formattedPhone,
      simulated: false,
      error: err.message,
    };
  }
}

export async function sendBulkSms(
  recipients: string[],
  messageTemplate: string,
  triggerType: 'BROADCAST' | 'MANUAL' = 'BROADCAST',
  customerNames?: Record<string, string>
) {
  const results: SmsResult[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const phone of recipients) {
    const custName = customerNames?.[phone] || 'Customer';
    const personalizedMessage = messageTemplate.replace(/\{name\}/gi, custName);

    try {
      const res = await sendSms({
        to: phone,
        message: personalizedMessage,
        triggerType,
      });

      if (res.success) {
        sentCount++;
      } else {
        failedCount++;
      }
      results.push(res);
    } catch (e: any) {
      failedCount++;
      results.push({
        success: false,
        status: 'FAILED',
        recipient: phone,
        simulated: false,
        error: e.message,
      });
    }
  }

  return {
    total: recipients.length,
    sent: sentCount,
    failed: failedCount,
    results,
  };
}

export async function getAfroMessageAccountStatus() {
  const token = process.env.AFROMESSAGE_API_TOKEN;
  const isLive = Boolean(
    token &&
    token.trim() !== '' &&
    !token.includes('mock') &&
    !token.includes('YOUR_AFROMESSAGE')
  );

  if (!isLive) {
    return {
      mode: 'SIMULATED',
      connected: true,
      balance: '500 (Simulated Credits)',
      sender: process.env.AFROMESSAGE_SENDER_NAME || 'HaileBorito',
      identifier: process.env.AFROMESSAGE_IDENTIFIER || 'haile_borito_id',
      note: 'Using built-in sandbox simulator. Configure real token in .env when ready.',
    };
  }

  try {
    // Call AfroMessage balance/account endpoint
    const res = await fetch('https://api.afromessage.com/api/balance', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const rawBalance = data?.response?.balance;
      const estimatedMessages = data?.response?.estimatedMessages;
      const balanceDisplay = rawBalance !== undefined
        ? `${Number(rawBalance).toFixed(2)} ETB (${estimatedMessages ?? 'N/A'} SMS left)`
        : (data?.acknowledge === 'success' ? 'Active' : 'Unavailable');

      return {
        mode: 'LIVE',
        connected: data?.acknowledge === 'success',
        balance: balanceDisplay,
        rawBalance,
        estimatedMessages,
        sender: process.env.AFROMESSAGE_SENDER_NAME || 'Default',
        identifier: process.env.AFROMESSAGE_IDENTIFIER || 'Default',
        data,
      };
    } else {
      return {
        mode: 'LIVE',
        connected: false,
        balance: 'Unavailable',
        error: `Status ${res.status}: ${res.statusText}`,
      };
    }
  } catch (err: any) {
    return {
      mode: 'LIVE',
      connected: false,
      balance: 'Network Error',
      error: err.message,
    };
  }
}
