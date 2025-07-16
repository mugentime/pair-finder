// app.js
const app = {
  proxy(route, method = 'GET', params = {}) {
    const key    = document.getElementById('apiKey').value.trim();
    const secret = document.getElementById('apiSecret').value.trim();
    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route, method, key, secret, params })
    }).then(r => r.json());
  },

  fetchSimpleEarn()   { return this.proxy('/sapi/v1/simple-earn/flexible/list', 'GET', { size: 200 }); },
  fetchLoanable()     { return this.proxy('/sapi/v2/loan/flexible/loanable/data', 'GET'); },
  fetchPrice(symbol)  { return fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`).then(r => r.json()); },
  fetchKlines(symbol, interval='1d', limit=30) {
    return fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`).then(r => r.json());
  },

  async fetchAndRank() {
    const lookback = +document.getElementById('lookback').value || 30;
    document.getElementById('results').innerText = 'Loading…';

    const [earn, loan] = await Promise.all([this.fetchSimpleEarn(), this.fetchLoanable()]);

    console.log('Earn response:', earn);
    console.log('Loan response:', loan);

    const earnRows = earn?.data?.rows || earn?.rows;
    const loanRows = loan?.rows || loan?.data?.rows;

    if (!earnRows || !loanRows) {
      document.getElementById('results').innerText = 'API call failed or returned unexpected format.';
      return;
    }

    const aprMap   = Object.fromEntries(earnRows.map(r => [r.asset, +r.realtimeApr]));
    const borrowMap= Object.fromEntries(loanRows.map(r => [r.loanCoin, +r.flexibleInterestRate]));

    const symbols  = Object.keys(aprMap);
    const pairs    = [];
    for (const collateral of symbols) {
      for (const borrow of Object.keys(borrowMap)) {
        if (collateral === borrow) continue;

        const [cK, bK] = await Promise.all([
          this.fetchKlines(collateral + 'USDT', '1d', lookback),
          this.fetchKlines(borrow     + 'USDT', '1d', lookback)
        ]);

        const growth = (klines) => {
          const open = +klines[0][1], close = +klines.at(-1)[4];
          return (close - open) / open;
        };

        const score = (aprMap[collateral] - borrowMap[borrow]) + (growth(cK) - growth(bK));
        pairs.push({ collateral, borrow, score, apr: aprMap[collateral], borrowRate: borrowMap[borrow] });
      }
    }

    pairs.sort((a,b) => b.score - a.score);
    this.render(pairs.slice(0, 25));
  },

  render(data) {
    const html = [
      '<table><thead>',
      '<tr><th>Collateral</th><th>Borrow</th><th>APR (%)</th><th>Borrow Rate (%)</th><th>Score</th></tr>',
      '</thead><tbody>',
      ...data.map(r => `<tr><td>${r.collateral}</td><td>${r.borrow}</td><td>${(r.apr*100).toFixed(2)}</td><td>${(r.borrowRate*100).toFixed(2)}</td><td>${r.score.toFixed(4)}</td></tr>`),
      '</tbody></table>'
    ].join('');
    document.getElementById('results').innerHTML = html;
  }
};
