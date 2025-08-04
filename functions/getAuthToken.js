const { google } = require('googleapis');
const http = require('http'); // Used for a simple server to capture the redirect
const url = require('url');   // Used for parsing the redirect URL

// ==============================================================================
// IMPORTANT: Replace these with your actual Client ID and Client Secret
// from the "Desktop app" OAuth 2.0 Client ID you created.
// ==============================================================================
const CLIENT_ID = '48273856960-7rsu43a8fld2gmn703gp6vao4ced5crf.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
// ==============================================================================

// This URI must exactly match one of the "Authorized redirect URIs"
// in your "Desktop app" OAuth 2.0 Client ID settings in Google Cloud Console.
// For desktop apps, localhost with an arbitrary port is common.
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Define the scope: what permissions you are requesting.
// 'https://mail.google.com/' grants full access to the Gmail API,
// which is required for sending emails.
const scopes = ['https://mail.google.com/'];

// Generate the authorization URL
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', // *** ESSENTIAL: This ensures you get a refresh token ***
  scope: scopes,
  prompt: 'consent', // Forces the consent screen to appear every time (useful for testing)
});

console.log('---------------------------------------------------------');
console.log('Step 1: Open this URL in your web browser:');
console.log(authUrl);
console.log('---------------------------------------------------------');
console.log('\nStep 2: After you grant permission, you will be redirected');
console.log(`to ${REDIRECT_URI}. The script will then capture the token.`);
console.log('---------------------------------------------------------');

// Start a simple local server to capture the redirect
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth2callback')) {
    const query = url.parse(req.url, true).query;
    const code = query.code;

    if (code) {
      try {
        // Exchange the authorization code for tokens
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        console.log('\n=========================================================');
        console.log('Authentication successful!');
        console.log('Your Refresh Token:');
        console.log('---------------------------------------------------------');
        console.log(tokens.refresh_token); // <<<<<<<<<<<<<<<<<<<<<< THIS IS IT!
        console.log('---------------------------------------------------------');
        console.log('\nIMPORTANT: Copy this Refresh Token and store it securely.');
        console.log('You will use it in your Firebase Extension configuration.');
        console.log('=========================================================');

        res.end('Authentication successful! You can now close this browser tab.');
        server.close(() => {
          console.log('Local server closed.');
        });
      } catch (error) {
        console.error('Error retrieving tokens:', error.message);
        res.end('Authentication failed. Check your console for errors.');
        server.close();
      }
    } else {
      res.end('No authorization code found.');
      server.close();
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Waiting for OAuth2 redirect...</h1><p>Please open the URL displayed in your terminal.</p>');
  }
});

server.listen(3000, () => {
  console.log(`\nLocal server listening on ${REDIRECT_URI.split('/oauth2callback')[0]}`);
});
