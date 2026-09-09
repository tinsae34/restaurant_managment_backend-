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
  const token = process.env.AFROMESSAGE_API_TOKEN;
  const identifier = process.env.AFROMESSAGE_IDENTIFIER || 'HaileBorito';
  const senderName = process.env.AFROMESSAGE_SENDER_NAME || 'HaileFood';

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
    const payload = {
      from: identifier,
      sender: senderName,
      to: normalizedPhone,
      message: message,
    };

    const response = await fetch('https://api.afromessage.com/api/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({ status: response.statusText }));

    if (response.ok) {
      await prisma.smsLog.create({
        data: {
          recipient: normalizedPhone,
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
        recipient: normalizedPhone,
        simulated: false,
        responseData,
      };
    } else {
      console.error('[AfroMessage API Error]', responseData);
      await prisma.smsLog.create({
        data: {
          recipient: normalizedPhone,
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
        recipient: normalizedPhone,
        simulated: false,
        responseData,
        error: responseData?.message || 'AfroMessage API error',
      };
    }
  } catch (err: any) {
    console.error('[AfroMessage Network Error]', err);
    await prisma.smsLog.create({
      data: {
        recipient: normalizedPhone,
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
      recipient: normalizedPhone,
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
      return {
        mode: 'LIVE',
        connected: true,
        balance: data?.balance ?? 'Active',
        sender: process.env.AFROMESSAGE_SENDER_NAME,
        identifier: process.env.AFROMESSAGE_IDENTIFIER,
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
