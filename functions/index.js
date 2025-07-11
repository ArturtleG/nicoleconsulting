/* eslint-disable require-jsdoc, valid-jsdoc */
const {setGlobalOptions} = require("firebase-functions");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Busboy = require("busboy");
const nodemailer = require("nodemailer");

// Limit concurrency to 10 instances
setGlobalOptions({maxInstances: 10});

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Configure your SMTP transport (e.g. Gmail with App Password)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "web@mcree-ed.consulting",
    pass: functions.config().gmail.app_password,
  },
});

/**
 * Parse an incoming multipart/form-data request into a simple key/value object.
 */
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const busboy = new Busboy({headers: req.headers});
    const fields = {};
    busboy.on("field", (name, val) => (fields[name] = val));
    busboy.on("finish", () => resolve(fields));
    busboy.on("error", reject);
    busboy.end(req.rawBody);
  });
}

/**
 * HTTP handler for contact‐form submissions.
 */
exports.submitContact = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  try {
    const data = await parseForm(req);
    // 1) Save to Firestore
    await db.collection("contacts").add({
      name: data.name || null,
      email: data.email || null,
      message: data.message || null,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // 2) Send notification email
    await transporter.sendMail({
      from: "WEB <web@mcree-ed.consulting>",
      to: ["web@mcree-ed.consulting"],
      subject: `New Contact: ${data.name || "Anonymous"}`,
      text: `Name: ${data.name}\nEmail: ${data.email}\n\n${data.message}`,
    });
    return res.json({success: true});
  } catch (err) {
    console.error("submitContact error", err);
    return res.status(500).json({error: "Internal Server Error"});
  }
});

/**
 * HTTP handler for endorsement‐form submissions.
 */
exports.submitEndorsement = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  try {
    const data = await parseForm(req);
    // 1) Save to Firestore
    await db.collection("endorsements").add({
      name: data.name || null,
      email: data.email || null,
      endorsement: data.endorsement || null,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // 2) Send notification email
    await transporter.sendMail({
      from: "WEB <web@mcree-ed.consulting>",
      to: ["web@mcree-ed.consulting"],
      subject: `New Endorsement: ${data.name || "Anonymous"}`,
      text: `Name: ${data.name}\nEmail: ${data.email}\n\n${data.endorsement}`,
    });
    return res.json({success: true});
  } catch (err) {
    console.error("submitEndorsement error", err);
    return res.status(500).json({error: "Internal Server Error"});
  }
});
