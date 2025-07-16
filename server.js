/**
 * Simple Express proxy that signs and relays Binance
 * API requests so the browser never hits CORS blocks.
 */
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const cors    = require('cors');

const app = express();
app.use(cors());            // tighten this in production
app.use(express.json());

function sign(qs, secret) {
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

async function callBinance({ route, method, key, secret, params = {}, body = {} }) {
  const timestamp = Date.now();
  const query     = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = sign(query, secret);
  const url       = `https://api.binance.com${route}?${query}&signature=${signature}`;

  return axios.request({
    url,
    method,
    headers: { 'X-MBX-APIKEY': key },
    data: body
  });
}

app.post('/api/proxy', async (req, res) => {
  try {
    const { route, method = 'GET', key, secret, params, body } = req.body;
    const { data } = await callBinance({ route, method, key, secret, params, body });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Proxy running on :${PORT}`));
