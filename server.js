/**
 * Entry point for cPanel's "Setup Node.js App" (Phusion Passenger).
 * Passenger requires a plain script that starts an HTTP server listening on
 * process.env.PORT — it cannot directly run the `next start` CLI command.
 * Not used for local dev (`npm run dev`) or `npm start` elsewhere; those use
 * the Next.js CLI directly. This file is only the cPanel deployment target.
 */
const { createServer } = require("http");
const next = require("next");

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log(`DilKhush Dhaba ready on port ${port}`);
  });
});
