// ============================================================
// MOBILE MONEY INTEGRATION FOR UGANDA
// Supports: MTN Mobile Money, Airtel Money, M-Pesa
// Provider: Flutterwave
// ============================================================

const axios = require('axios');

// Flutterwave API Configuration
const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY || 'FLWPUBK_TEST-your-key-here';
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || 'FLWSECK_TEST-your-key-here';
const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'your-webhook-hash';
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

// ============================================================
// PAYMENT TYPES
// ============================================================

const PAYMENT_TYPES = {
  PREMIUM_MONTHLY: { amount: 10000, description: 'DJ Musta Premium (1 Month)' },
  PREMIUM_YEARLY: { amount: 100000, description: 'DJ Musta Premium (1 Year)' },
  ARTIST_TIP_SMALL: { amount: 1000, description: 'Artist Tip' },
  ARTIST_TIP_MEDIUM: { amount: 5000, description: 'Artist Tip' },
  ARTIST_TIP_LARGE: { amount: 10000, description: 'Artist Tip' },
  SONG_DOWNLOAD: { amount: 500, description: 'Song Download' },
  FEATURED_SONG: { amount: 50000, description: 'Featured Song Placement (7 Days)' }
};

// ============================================================
// MOBILE MONEY NETWORKS
// ============================================================

const NETWORKS = {
  MTN: 'mtn',
  AIRTEL: 'airtel',
  MPESA: 'mpesa'
};

// ============================================================
// INITIATE MOBILE MONEY PAYMENT
// ============================================================

async function initiateMobileMoneyPayment(data) {
  const {
    amount,
    phone,
    network, // 'mtn', 'airtel', or 'mpesa'
    email,
    fullname,
    paymentType,
    metadata = {}
  } = data;

  // Validate phone number (Uganda format)
  const cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('256') || cleanPhone.length !== 12) {
    throw new Error('Invalid Uganda phone number. Use format: 256780123456');
  }

  // Generate unique transaction reference
  const txRef = `DJMUSTA-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const payload = {
    tx_ref: txRef,
    amount: amount,
    currency: 'UGX',
    email: email,
    phone_number: cleanPhone,
    fullname: fullname,
    network: network.toUpperCase(),
    redirect_url: `${process.env.FRONTEND_URL || 'https://djmusta.com'}/payment/callback`,
    meta: {
      payment_type: paymentType,
      ...metadata
    }
  };

  try {
    const response = await axios.post(
      `${FLW_BASE_URL}/charges?type=mobile_money_uganda`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status === 'success') {
      return {
        success: true,
        reference: txRef,
        message: response.data.message || 'Payment initiated. Please approve on your phone.',
        data: response.data.data
      };
    } else {
      throw new Error(response.data.message || 'Payment initiation failed');
    }
  } catch (error) {
    console.error('Mobile Money Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to initiate payment');
  }
}

// ============================================================
// VERIFY PAYMENT STATUS
// ============================================================

async function verifyPayment(transactionId) {
  try {
    const response = await axios.get(
      `${FLW_BASE_URL}/transactions/${transactionId}/verify`,
      {
        headers: {
          'Authorization': `Bearer ${FLW_SECRET_KEY}`
        }
      }
    );

    if (response.data.status === 'success') {
      const txData = response.data.data;
      
      return {
        success: txData.status === 'successful',
        amount: txData.amount,
        currency: txData.currency,
        reference: txData.tx_ref,
        paymentType: txData.meta?.payment_type,
        customerEmail: txData.customer.email,
        customerPhone: txData.customer.phone_number,
        paidAt: txData.created_at
      };
    }

    return { success: false, message: 'Payment verification failed' };
  } catch (error) {
    console.error('Verification Error:', error.response?.data || error.message);
    throw new Error('Failed to verify payment');
  }
}

// ============================================================
// PROCESS WEBHOOK (Flutterwave sends payment status)
// ============================================================

function verifyWebhookSignature(signature, body) {
  // Verify webhook is actually from Flutterwave
  return signature === FLW_SECRET_HASH;
}

async function processWebhook(webhookData) {
  const { event, data } = webhookData;

  if (event === 'charge.completed') {
    const payment = data;

    if (payment.status === 'successful' && payment.currency === 'UGX') {
      return {
        success: true,
        reference: payment.tx_ref,
        amount: payment.amount,
        email: payment.customer.email,
        phone: payment.customer.phone_number,
        paymentType: payment.meta?.payment_type,
        metadata: payment.meta
      };
    }
  }

  return { success: false };
}

// ============================================================
// GET AVAILABLE NETWORKS
// ============================================================

function getAvailableNetworks() {
  return [
    {
      id: NETWORKS.MTN,
      name: 'MTN Mobile Money',
      code: 'MTN',
      logo: '🟡',
      ussdCode: '*165*3#',
      description: 'Dial *165*3# and approve payment'
    },
    {
      id: NETWORKS.AIRTEL,
      name: 'Airtel Money',
      code: 'AIRTEL',
      logo: '🔴',
      ussdCode: '*185#',
      description: 'Dial *185# and approve payment'
    },
    {
      id: NETWORKS.MPESA,
      name: 'M-Pesa',
      code: 'MPESA',
      logo: '🟢',
      ussdCode: '*234#',
      description: 'Dial *234# and approve payment'
    }
  ];
}

// ============================================================
// GENERATE PAYMENT LINK (For sharing)
// ============================================================

async function generatePaymentLink(data) {
  const {
    amount,
    email,
    fullname,
    description,
    reference
  } = data;

  const payload = {
    tx_ref: reference || `DJMUSTA-LINK-${Date.now()}`,
    amount: amount,
    currency: 'UGX',
    redirect_url: `${process.env.FRONTEND_URL || 'https://djmusta.com'}/payment/success`,
    customer: {
      email: email,
      name: fullname
    },
    customizations: {
      title: 'DJ Musta Payment',
      description: description,
      logo: 'https://djmusta.com/favicon.svg'
    }
  };

  try {
    const response = await axios.post(
      `${FLW_BASE_URL}/payments`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status === 'success') {
      return {
        success: true,
        link: response.data.data.link,
        reference: payload.tx_ref
      };
    }

    throw new Error('Failed to generate payment link');
  } catch (error) {
    console.error('Payment Link Error:', error.response?.data || error.message);
    throw new Error('Failed to generate payment link');
  }
}

// ============================================================
// REFUND PAYMENT (If needed)
// ============================================================

async function refundPayment(transactionId, amount) {
  try {
    const response = await axios.post(
      `${FLW_BASE_URL}/transactions/${transactionId}/refund`,
      { amount: amount },
      {
        headers: {
          'Authorization': `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status === 'success') {
      return {
        success: true,
        message: 'Refund processed successfully',
        data: response.data.data
      };
    }

    throw new Error('Refund failed');
  } catch (error) {
    console.error('Refund Error:', error.response?.data || error.message);
    throw new Error('Failed to process refund');
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  initiateMobileMoneyPayment,
  verifyPayment,
  processWebhook,
  verifyWebhookSignature,
  getAvailableNetworks,
  generatePaymentLink,
  refundPayment,
  PAYMENT_TYPES,
  NETWORKS
};
