// server.js
import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// Proxy route to access Binance API securely
app.post('/api/proxy', async (req, res) => {
  const { route, method, key, secret, params } = req.body;
  const queryString = new URLSearchParams(params).toString();
  const url = `https://api.binance.com${route}?${queryString}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': key,
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Binance API' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
