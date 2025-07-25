/* eslint-disable require-jsdoc, valid-jsdoc */
const { setGlobalOptions } = require('firebase-functions/v2');
const { onRequest }        = require('firebase-functions/v2/https');
const { initializeApp }    = require('firebase-admin/app');
const {
  getFirestore,
  FieldValue,
  Timestamp
}                          = require('firebase-admin/firestore');
const nodemailer           = require('nodemailer');
const cors                 = require('cors')();

// Cap concurrency at 10 instances
setGlobalOptions({ maxInstances: 10 });

// Initialize Firebase Admin & Firestore (modular API)
initializeApp();
const db = getFirestore();

// Configure your SMTP transport (Gmail App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'web@mcree-ed.consulting',
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ------------------ submitContact ------------------
exports.submitContact = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { name, email, message } = req.body;

    try {
      // 1) Persist to Firestore with serverTimestamp()
      await db.collection('contacts').add({
        name: name       || null,
        email: email     || null,
        message: message || null,
        submittedAt: FieldValue.serverTimestamp(),
      });

      // 2) Send notification email
      await transporter.sendMail({
        from:    'WEB <web@mcree-ed.consulting>',
        to:      ['web@mcree-ed.consulting'],
        subject: `New Contact: ${name || 'Anonymous'}`,
        text:    `Name: ${name}\nEmail: ${email}\n\n${message}`,
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('submitContact error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
});

// --------------- submitEndorsement ---------------
exports.submitEndorsement = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { name, email, endorsement } = req.body;

    try {
      // 1) Persist to Firestore
      await db.collection('endorsements').add({
        name:        name        || null,
        email:       email       || null,
        endorsement: endorsement || null,
        submittedAt: FieldValue.serverTimestamp(),
      });

      // 2) Send notification email
      await transporter.sendMail({
        from:    'WEB <web@mcree-ed.consulting>',
        to:      ['web@mcree-ed.consulting'],
        subject: `New Endorsement: ${name || 'Anonymous'}`,
        text:    `Name: ${name}\nEmail: ${email}\n\n${endorsement}`,
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('submitEndorsement error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
});