// Binance Optimal Pair Finder - JavaScript (Fixed)

class BinanceOptimalPairFinder {
  constructor() {
    this.apiKey = '';
    this.apiSecret = '';
    this.lookbackDays = 30;
    this.maxPairs = 25;
    this.results = [];
    this.sortColumn = 'compositeScore';
    this.sortDirection = 'desc';

    this.initializeUI();
  }

  initializeUI() {
    // Settings panel toggle
    const toggleBtn = document.getElementById('toggleSettings');
    const settingsContent = document.getElementById('settingsContent');
    const toggleText = document.getElementById('toggleText');
    
    toggleBtn.addEventListener('click', () => {
      settingsContent.classList.toggle('collapsed');
      toggleText.textContent = settingsContent.classList.contains('collapsed') ? 'Show' : 'Hide';
    });

    // Fetch button
    document.getElementById('fetchButton').addEventListener('click', () => {
      this.fetchAndRank();
    });

    // Table header sorting
    document.querySelectorAll('[data-sort]').forEach((header) => {
      header.addEventListener('click', (e) => {
        const column = e.currentTarget.dataset.sort;
        this.sortTable(column);
      });
    });

    // Modal close
    document.getElementById('closeModal').addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') {
        this.closeModal();
      }
    });

    // Initialize sort indicators
    this.updateSortIndicators();
  }

  async fetchAndRank() {
    // Read settings
    this.apiKey = document.getElementById('apiKey').value.trim();
    this.apiSecret = document.getElementById('apiSecret').value.trim();
    this.lookbackDays = parseInt(document.getElementById('lookbackDays').value) || 30;
    this.maxPairs = parseInt(document.getElementById('maxPairs').value) || 25;

    if (!this.apiKey || !this.apiSecret) {
      this.showToast('Please enter both API Key and Secret Key', 'error');
      return;
    }

    // Reset previous results
    this.results = [];
    document.getElementById('resultsBody').innerHTML = '';
    document.getElementById('resultsContainer').classList.add('hidden');

    this.showLoading(true);
    this.updateFetchButton('Fetching...');

    try {
      // Fetch data from Binance
      const [earnData, loanData] = await Promise.all([
        this.fetchSimpleEarnData(),
        this.fetchLoanableData()
      ]);

      // Derive unique asset list
      const earnAssets = earnData.map((r) => r.asset);
      const loanAssets = loanData.map((r) => r.loanCoin);
      const uniqueAssets = [...new Set([...earnAssets, ...loanAssets])];

      // Fetch prices (single endpoint covers all USDT pairs)
      const priceMap = await this.fetchPriceMap();

      // Fetch growth data (per asset)
      const growthMap = await this.fetchGrowthMap(uniqueAssets);

      // Compose and rank pairs
      this.composePairs(earnData, loanData, priceMap, growthMap);

      // Render table
      this.renderResults();
      this.showToast('Data fetched successfully!');
    } catch (err) {
      console.error(err);
      this.showToast(err.message || 'Unknown error', 'error');
    } finally {
      this.showLoading(false);
      this.updateFetchButton('Fetch & Rank');
    }
  }

  async fetchSimpleEarnData() {
    const timestamp = Date.now();
    const params = `size=100&timestamp=${timestamp}`;
    const signature = await this.generateSignature(params);

    const url = `https://api.binance.com/sapi/v1/simple-earn/flexible/list?${params}&signature=${signature}`;
    const res = await fetch(url, { headers: { 'X-MBX-APIKEY': this.apiKey } });
    if (!res.ok) throw new Error(`Simple Earn API error (${res.status})`);
    const json = await res.json();
    return json.rows || [];
  }

  async fetchLoanableData() {
    const timestamp = Date.now();
    const params = `timestamp=${timestamp}`;
    const signature = await this.generateSignature(params);

    const url = `https://api.binance.com/sapi/v2/loan/flexible/loanable/data?${params}&signature=${signature}`;
    const res = await fetch(url, { headers: { 'X-MBX-APIKEY': this.apiKey } });
    if (!res.ok) throw new Error(`Loanable Data API error (${res.status})`);
    const json = await res.json();
    return json.rows || [];
  }

  async fetchPriceMap() {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (!res.ok) throw new Error(`Price API error (${res.status})`);
    const data = await res.json();
    const map = {};
    data.forEach((d) => {
      if (d.symbol.endsWith('USDT')) {
        map[d.symbol.replace('USDT', '')] = parseFloat(d.price);
      }
    });
    return map;
  }

  async fetchGrowthMap(assets) {
    const map = {};
    const limit = this.lookbackDays + 1;

    await Promise.all(
      assets.map(async (asset) => {
        const symbol = `${asset}USDT`;
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`
          );
          if (!res.ok) throw new Error();
          const klines = await res.json();
          if (klines.length < 2) {
            map[asset] = 0;
            return;
          }
          const firstClose = parseFloat(klines[0][4]);
          const lastClose = parseFloat(klines[klines.length - 1][4]);
          map[asset] = ((lastClose - firstClose) / firstClose) * 100;
        } catch {
          map[asset] = 0; // fallback
        }
      })
    );
    return map;
  }

  composePairs(earnData, loanData, priceMap, growthMap) {
    const pairs = [];
    earnData.forEach((earn) => {
      loanData.forEach((loan) => {
        if (earn.asset === loan.loanCoin) return; // Skip identical asset

        const collateralAPR = parseFloat(earn.latestAnnualPercentageRate || 0);
        const borrowAPR = parseFloat(loan.flexibleInterestRate || 0) * 24 * 365; // hourly → annual
        const collateralGrowth = growthMap[earn.asset] || 0;
        const borrowGrowth = growthMap[loan.loanCoin] || 0;
        const compositeScore = collateralAPR - borrowAPR + (collateralGrowth - borrowGrowth);

        pairs.push({
          collateralAsset: earn.asset,
          borrowAsset: loan.loanCoin,
          collateralAPR,
          borrowAPR,
          collateralGrowth,
          borrowGrowth,
          compositeScore,
          collateralPrice: priceMap[earn.asset] || 0,
          borrowPrice: priceMap[loan.loanCoin] || 0,
          loanData: loan
        });
      });
    });

    // Order and trim
    this.results = pairs
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, this.maxPairs);
  }

  renderResults() {
    const tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '';

    if (this.results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;">No results</td></tr>';
      document.getElementById('resultsContainer').classList.remove('hidden');
      return;
    }

    const data = this.getSortedResults();
    data.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.collateralAsset}</td>
        <td>${row.collateralAPR.toFixed(4)}</td>
        <td>${row.borrowAsset}</td>
        <td>${row.borrowAPR.toFixed(4)}</td>
        <td>${row.collateralGrowth.toFixed(2)}</td>
        <td>${row.borrowGrowth.toFixed(2)}</td>
        <td>${row.compositeScore.toFixed(2)}</td>
        <td><button class="btn btn--secondary btn--sm" data-idx="${idx}">View</button></td>
      `;
      // Detail button handler
      tr.querySelector('button').addEventListener('click', (e) => {
        const i = parseInt(e.currentTarget.dataset.idx);
        this.showDetails(i);
      });
      tbody.appendChild(tr);
    });

    document.getElementById('resultsContainer').classList.remove('hidden');
  }

  getSortedResults() {
    const copy = [...this.results];
    copy.sort((a, b) => {
      const aVal = a[this.sortColumn];
      const bVal = b[this.sortColumn];
      if (typeof aVal === 'string') {
        return this.sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return this.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }

  sortTable(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }
    this.updateSortIndicators();
    this.renderResults();
  }

  updateSortIndicators() {
    document.querySelectorAll('.sort-indicator').forEach((el) => (el.textContent = ''));
    const active = document.querySelector(`[data-sort="${this.sortColumn}"] .sort-indicator`);
    if (active) active.textContent = this.sortDirection === 'asc' ? '↑' : '↓';
  }

  showDetails(idx) {
    const pair = this.getSortedResults()[idx];
    const overlay = document.getElementById('modalOverlay');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    title.textContent = `${pair.collateralAsset} / ${pair.borrowAsset}`;

    const ltvSection = pair.loanData.initialLTV
      ? `<div>
            <h4>LTV Information</h4>
            <p>Initial LTV: ${(parseFloat(pair.loanData.initialLTV) * 100).toFixed(2)}%</p>
            <p>Margin Call LTV: ${(parseFloat(pair.loanData.marginCallLTV || 0) * 100).toFixed(2)}%</p>
            <p>Liquidation LTV: ${(parseFloat(pair.loanData.liquidationLTV || 0) * 100).toFixed(2)}%</p>
        </div>`
      : '';

    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div>
          <h4>Collateral Asset: ${pair.collateralAsset}</h4>
          <p>Current Price: $${pair.collateralPrice.toFixed(6)}</p>
          <p>Simple Earn APR: ${pair.collateralAPR.toFixed(4)}%</p>
          <p>Price Growth (${this.lookbackDays}d): ${pair.collateralGrowth.toFixed(2)}%</p>
          <a href="https://www.tradingview.com/symbols/${pair.collateralAsset}USDT/" target="_blank" class="btn btn--outline btn--sm">View on TradingView</a>
        </div>
        <div>
          <h4>Borrow Asset: ${pair.borrowAsset}</h4>
          <p>Current Price: $${pair.borrowPrice.toFixed(6)}</p>
          <p>Loan APR: ${pair.borrowAPR.toFixed(4)}%</p>
          <p>Price Growth (${this.lookbackDays}d): ${pair.borrowGrowth.toFixed(2)}%</p>
          <a href="https://www.tradingview.com/symbols/${pair.borrowAsset}USDT/" target="_blank" class="btn btn--outline btn--sm">View on TradingView</a>
        </div>
        <div>
          <h4>Composite Analysis</h4>
          <p>Net APR Advantage: ${(pair.collateralAPR - pair.borrowAPR).toFixed(4)}%</p>
          <p>Net Growth Advantage: ${(pair.collateralGrowth - pair.borrowGrowth).toFixed(2)}%</p>
          <p><strong>Composite Score: ${pair.compositeScore.toFixed(2)}</strong></p>
        </div>
        ${ltvSection}
      </div>
    `;
    overlay.classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
  }

  showLoading(show) {
    const loader = document.getElementById('loadingContainer');
    show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
  }

  updateFetchButton(text) {
    const btn = document.getElementById('fetchButton');
    document.getElementById('fetchButtonText').textContent = text;
    btn.disabled = text !== 'Fetch & Rank';
  }

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' toast--error' : ''}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 5000);
  }

  async generateSignature(queryString) {
    const enc = new TextEncoder();
    const keyData = enc.encode(this.apiSecret);
    const algo = { name: 'HMAC', hash: 'SHA-256' };

    const cryptoKey = await crypto.subtle.importKey('raw', keyData, algo, false, ['sign']);
    const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(queryString));
    return Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

// Initialize global app instance
window.app = new BinanceOptimalPairFinder();