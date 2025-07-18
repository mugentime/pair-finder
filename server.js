// server.js
import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.post('/api/proxy', async (req, res) => {
  const { route, method, key, secret, params } = req.body;
  const isSigned = route?.startsWith('/sapi');
  const apiKey = BINANCE_API_KEY || key;
  const apiSecret = BINANCE_API_SECRET || secret;

  if (!route) {
    return res.status(400).json({ error: 'Missing route' });
  }
  if (isSigned && (!apiKey || !apiSecret)) {
    return res.status(400).json({ error: 'Missing API key or secret for signed request' });
  }

  let url;
  if (isSigned) {
    const timestamp = Date.now();
    const query = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    url = `https://api.binance.com${route}?${query}&signature=${signature}`;
  } else {
    const query = new URLSearchParams(params).toString();
    url = `https://api.binance.com${route}?${query}`;
  }

  try {
    const headers = isSigned ? { 'X-MBX-APIKEY': apiKey } : {};
    console.log('▶️ Binance request:', url);
    console.log('Headers:', headers);

    const response = await fetch(url, {
      method,
      headers,
    });
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Binance API error:', data);
      return res.status(response.status).json({ error: data });
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Network or fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Binance API', details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
