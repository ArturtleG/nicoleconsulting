/* eslint-disable require-jsdoc, valid-jsdoc */
const { setGlobalOptions }        = require('firebase-functions');
const { onRequest }               = require('firebase-functions/v2/https');
const { initializeApp }           = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express                     = require('express');
const cors                        = require('cors');
const nodemailer                  = require('nodemailer');

// —— CONFIGURE & INIT ————————————————————————————————————————————————
setGlobalOptions({ maxInstances: 10 });      // limit concurrency
initializeApp();
const db = getFirestore();

// make sure you’ve set this env var in GCP or via `export`/`.env` locally
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'web@mcree-ed.consulting',
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// —— FACTORY TO BUILD EACH EXPRESS APP ——————————————————————————————
function makeFormHandler({ collection, textField, subjectLabel }) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.post('/', async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
      const { name = null, email = null } = req.body;
      const text = req.body[textField] || null;

      // 1) write to Firestore
      await db.collection(collection).add({
        name,
        email,
        [textField]: text,
        submittedAt: FieldValue.serverTimestamp(),
      });

      // 2) send email
      await transporter.sendMail({
        from:    'WEB <web@mcree-ed.consulting>',
        to:      ['web@mcree-ed.consulting'],
        subject: `New ${subjectLabel}: ${name || 'Anonymous'}`,
        text:    `Name: ${name}\nEmail: ${email}\n\n${text}`,
      });

      return res.json({ success: true });
    } catch (err) {
      console.error(`${subjectLabel} error:`, err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return app;
}

// ——— EXPORT YOUR FUNCTIONS —————————————————————————————————————
exports.submitContact     = onRequest(makeFormHandler({
  collection:  'contacts',
  textField:   'message',
  subjectLabel: 'Contact'
}));

exports.submitEndorsement = onRequest(makeFormHandler({
  collection:  'endorsements',
  textField:   'endorsement',
  subjectLabel: 'Endorsement'
}));
