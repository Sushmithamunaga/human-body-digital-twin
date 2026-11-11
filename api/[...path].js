// Vercel serverless entry: every /api/* request is handled by the shared app.
module.exports = require('../lib/app').handler;
