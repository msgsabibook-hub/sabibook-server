const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'SabiBook server running' });
});

// Flutterwave webhook
app.post('/webhook/flutterwave', async (req, res) => {
  try {
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature = req.headers['verif-hash'];
    
    if (!signature || signature !== secretHash) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    
    if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
      const txRef = payload.data.tx_ref;
      const amount = payload.data.amount;
      const currency = payload.data.currency;
      const transactionId = payload.data.id.toString();
      
      // Verify with Flutterwave API
      const verifyRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
      );
      
      const verifiedData = verifyRes.data.data;
      
      if (verifiedData.status !== 'successful') {
        return res.status(400).json({ error: 'Payment verification failed' });
      }

      // Extract plan and uid from tx_ref
      // Format: SabiBook-{plan}-{uid_short}-{uuid}
      const parts = txRef.split('-');
      const plan = parts[1]; // monthly, yearly, or founder
      
      // Get uid from customer email (we store uid@sabibook.app)
      const customerEmail = verifiedData.customer.email;
      const uid = customerEmail.replace('@sabibook.app', '');
      
      // Calculate expiry
      let expiryMs;
      if (plan === 'founder') {
        expiryMs = 9999999999999;
      } else if (plan === 'monthly') {
        expiryMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      } else if (plan === 'yearly') {
        expiryMs = Date.now() + 365 * 24 * 60 * 60 * 1000;
      } else {
        return res.status(400).json({ error: 'Unknown plan' });
      }

      // Write to Firestore
      await db.collection('subscriptions').doc(uid).set({
        uid,
        plan,
        expiryMs,
        activatedAt: Date.now(),
        transactionId,
        txRef,
        amount,
        currency,
        source: 'flutterwave'
      });

      console.log(`Activated ${plan} for uid: ${uid}`);
      return res.status(200).json({ success: true });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SabiBook server running on port ${PORT}`);
});
