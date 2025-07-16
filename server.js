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

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.post('/api/proxy', async (req, res) => {
  const { route, method, key, secret, params } = req.body;
  const timestamp = Date.now();

  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  const url = `https://api.binance.com${route}?${query}&signature=${signature}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': key,
      },
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Binance API', details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
