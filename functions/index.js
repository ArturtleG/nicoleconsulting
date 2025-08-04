/* eslint-disable require-jsdoc, valid-jsdoc */
const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Cap concurrency at 10
setGlobalOptions({maxInstances: 10});

// Init Admin SDK
admin.initializeApp();
const db = admin.firestore();

// POST /submitContact → writes a contact doc
exports.submitContact = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  const {name, email, message} = req.body;
  try {
    await db.collection("contacts").add({
      name: name || null,
      email: email || null,
      message: message || null,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({success: true});
  } catch (err) {
    console.error("submitContact error:", err);
    return res.status(500).json({error: "Internal Server Error"});
  }
});

// POST /submitEndorsement → writes an endorsement doc
exports.submitEndorsement = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  const {name, email, endorsement} = req.body;
  try {
    await db.collection("endorsements").add({
      name: name || null,
      email: email || null,
      endorsement: endorsement || null,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({success: true});
  } catch (err) {
    console.error("submitEndorsement error:", err);
    return res.status(500).json({error: "Internal Server Error"});
  }
});
