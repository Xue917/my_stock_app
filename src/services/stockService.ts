// src/services/stockService.ts
import { Platform } from 'react-native';

export interface StockQuote {
  code: string;
  name: string;
  currentPrice: number;
  change?: number;
  changePercent?: string;
  market: 'TW' | 'US';
  currency: 'TWD' | 'USD';
  updatedAt: string;
  isRealtime?: boolean;
}

// 常用熱門台美股中英對照清單 (快速查詢與離線備援)
export const POPULAR_STOCKS: Record<string, { name: string; market: 'TW' | 'US'; currency: 'TWD' | 'USD' }> = {
  // 台股熱門標的
  '2330': { name: '台積電', market: 'TW', currency: 'TWD' },
  '2317': { name: '鴻海', market: 'TW', currency: 'TWD' },
  '2454': { name: '聯發科', market: 'TW', currency: 'TWD' },
  '2308': { name: '台達電', market: 'TW', currency: 'TWD' },
  '2382': { name: '廣達', market: 'TW', currency: 'TWD' },
  '2603': { name: '長榮', market: 'TW', currency: 'TWD' },
  '2609': { name: '陽明', market: 'TW', currency: 'TWD' },
  '2615': { name: '萬海', market: 'TW', currency: 'TWD' },
  '2881': { name: '富邦金', market: 'TW', currency: 'TWD' },
  '2882': { name: '國泰金', market: 'TW', currency: 'TWD' },
  '2891': { name: '中信金', market: 'TW', currency: 'TWD' },
  '2886': { name: '兆豐金', market: 'TW', currency: 'TWD' },
  '0050': { name: '元大台灣50', market: 'TW', currency: 'TWD' },
  '0056': { name: '元大高股息', market: 'TW', currency: 'TWD' },
  '00878': { name: '國泰永續高股息', market: 'TW', currency: 'TWD' },
  '00919': { name: '群益台灣精選高息', market: 'TW', currency: 'TWD' },
  '00929': { name: '復華台灣科技優息', market: 'TW', currency: 'TWD' },
  '00940': { name: '元大台灣價值高息', market: 'TW', currency: 'TWD' },
  '8069': { name: '元太', market: 'TW', currency: 'TWD' },
  '3443': { name: '創意', market: 'TW', currency: 'TWD' },
  '3661': { name: '世芯-KY', market: 'TW', currency: 'TWD' },
  '3008': { name: '大立光', market: 'TW', currency: 'TWD' },
  '2412': { name: '中華電', market: 'TW', currency: 'TWD' },
  '3293': { name: '鈊象', market: 'TW', currency: 'TWD' },

  // 美股熱門標的
  'NVDA': { name: '輝達 (NVIDIA)', market: 'US', currency: 'USD' },
  'AAPL': { name: '蘋果 (Apple)', market: 'US', currency: 'USD' },
  'TSLA': { name: '特斯拉 (Tesla)', market: 'US', currency: 'USD' },
  'MSFT': { name: '微軟 (Microsoft)', market: 'US', currency: 'USD' },
  'GOOGL': { name: '谷歌 (Alphabet A)', market: 'US', currency: 'USD' },
  'GOOG': { name: '谷歌 (Alphabet C)', market: 'US', currency: 'USD' },
  'AMZN': { name: '亞馬遜 (Amazon)', market: 'US', currency: 'USD' },
  'META': { name: 'Meta (Facebook)', market: 'US', currency: 'USD' },
  'AMD': { name: '超微 (AMD)', market: 'US', currency: 'USD' },
  'INTC': { name: '英特爾 (Intel)', market: 'US', currency: 'USD' },
  'TSM': { name: '台積電 ADR', market: 'US', currency: 'USD' },
  'NFLX': { name: '網飛 (Netflix)', market: 'US', currency: 'USD' },
  'AVGO': { name: '博通 (Broadcom)', market: 'US', currency: 'USD' },
  'QCOM': { name: '高通 (Qualcomm)', market: 'US', currency: 'USD' },
  'PLTR': { name: 'Palantir', market: 'US', currency: 'USD' },
  'SPY': { name: '標普500 ETF (SPY)', market: 'US', currency: 'USD' },
  'QQQ': { name: '那斯達克100 ETF (QQQ)', market: 'US', currency: 'USD' },
  'VOO': { name: '先鋒標普500 (VOO)', market: 'US', currency: 'USD' },
  'VT': { name: '先鋒全世界股票 (VT)', market: 'US', currency: 'USD' },
  'SOXX': { name: '費城半導體 ETF (SOXX)', market: 'US', currency: 'USD' },
};

/**
 * 判斷股票代號為台股或美股 (支援中文名稱直接比對)
 */
export function detectStockMarket(code: string): { market: 'TW' | 'US'; currency: 'TWD' | 'USD'; cleanCode: string } {
  const trimmed = (code || '').trim().toUpperCase();

  // 1. 若使用者輸入的是常用名稱 (如「台積電」或「輝達」)，自動反查代號
  const matchedEntry = Object.entries(POPULAR_STOCKS).find(
    ([k, v]) => v.name.toUpperCase().includes(trimmed) || trimmed.includes(v.name.toUpperCase())
  );
  if (matchedEntry) {
    return {
      market: matchedEntry[1].market,
      currency: matchedEntry[1].currency,
      cleanCode: matchedEntry[0],
    };
  }

  const cleanCode = trimmed.replace('.TW', '').replace('.TWO', '');
  
  // 若為純數字，或明確指定 .TW / .TWO，皆判定為台股
  const isTaiwan = /^\d+$/.test(cleanCode) || trimmed.includes('.TW') || trimmed.includes('.TWO');

  return {
    market: isTaiwan ? 'TW' : 'US',
    currency: isTaiwan ? 'TWD' : 'USD',
    cleanCode,
  };
}

/**
 * 取得前兩週日期作為查詢起始點 (確保避開連假、週末)
 */
function getLookupStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().split('T')[0];
}

/**
 * 封裝附帶超時控制的 fetch
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 原生環境直連 Yahoo Finance Chart API (免 Proxy)
 */
async function fetchYahooNative(symbol: string): Promise<{ price: number; change?: number; changePercent?: string; name?: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    if (typeof price !== 'number' || price <= 0) return null;

    const prev = meta.chartPreviousClose || meta.previousClose;
    let change: number | undefined;
    let changePercent = '';

    if (typeof prev === 'number' && prev > 0) {
      change = Math.round((price - prev) * 100) / 100;
      const pct = ((change / prev) * 100).toFixed(2);
      changePercent = `${change >= 0 ? '+' : ''}${pct}%`;
    }

    return {
      price,
      change,
      changePercent,
      name: meta.shortName || meta.symbol,
    };
  } catch {
    return null;
  }
}

/**
 * 原生環境直連證交所 MIS 即時報價 (針對台股)
 */
async function fetchTwseMisNative(code: string): Promise<{ price: number; change?: number; changePercent?: string; name?: string } | null> {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw|otc_${code}.tw&json=1&delay=0`;
    const res = await fetchWithTimeout(url, {}, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.msgArray?.find((x: any) => x.c === code);
    if (!item) return null;

    // z 為當前撮合成交價，y 為昨收價
    const rawPrice = item.z !== '-' ? item.z : item.y;
    const price = parseFloat(rawPrice);
    if (isNaN(price) || price <= 0) return null;

    const prev = parseFloat(item.y);
    let change: number | undefined;
    let changePercent = '';

    if (!isNaN(prev) && prev > 0) {
      change = Math.round((price - prev) * 100) / 100;
      const pct = ((change / prev) * 100).toFixed(2);
      changePercent = `${change >= 0 ? '+' : ''}${pct}%`;
    }

    return {
      price,
      change,
      changePercent,
      name: item.n || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 抓取單支股票即時報價 (支援台股與美股全市場)
 */
export async function fetchStockQuote(rawCode: string): Promise<StockQuote | null> {
  if (!rawCode || !rawCode.trim()) return null;

  const { market, currency, cleanCode } = detectStockMarket(rawCode);
  const popular = POPULAR_STOCKS[cleanCode];
  let defaultName = popular ? popular.name : cleanCode;
  const startDate = getLookupStartDate();
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  // 1. 優先嘗試 FinMind API (支援跨域 CORS，涵蓋全台股與全美股)
  try {
    const isTw = market === 'TW';
    const infoDataset = isTw ? 'TaiwanStockInfo' : 'USStockInfo';
    const priceDataset = isTw ? 'TaiwanStockPrice' : 'USStockPrice';

    const infoUrl = `https://api.finmindtrade.com/api/v4/data?dataset=${infoDataset}&data_id=${cleanCode}`;
    const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=${priceDataset}&data_id=${cleanCode}&start_date=${startDate}`;

    const [infoRes, priceRes] = await Promise.all([
      fetchWithTimeout(infoUrl, {}, 5000).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithTimeout(priceUrl, {}, 5000).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    let resolvedName = defaultName;
    if (infoRes?.data && infoRes.data.length > 0) {
      const rawName = infoRes.data[0].stock_name;
      if (rawName) {
        resolvedName = rawName.replace(/ Common Stock/i, '').replace(/ Class A/i, '').trim();
        if (popular) resolvedName = popular.name;
      }
    }

    if (priceRes?.data && priceRes.data.length > 0) {
      const list = priceRes.data;
      const lastItem = list[list.length - 1];
      const rawPrice = lastItem.close ?? lastItem.Close ?? lastItem.Adj_Close;
      const priceNum = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);

      if (!isNaN(priceNum) && priceNum > 0) {
        let change: number | undefined;
        let changePercent = '';

        if (typeof lastItem.spread === 'number') {
          change = lastItem.spread;
          const prev = priceNum - change;
          if (prev > 0) {
            const pct = ((change / prev) * 100).toFixed(2);
            changePercent = `${change >= 0 ? '+' : ''}${pct}%`;
          }
        } else if (list.length >= 2) {
          const prevItem = list[list.length - 2];
          const rawPrev = prevItem.close ?? prevItem.Close ?? prevItem.Adj_Close;
          const prevNum = typeof rawPrev === 'number' ? rawPrev : parseFloat(rawPrev);
          if (!isNaN(prevNum) && prevNum > 0) {
            change = Math.round((priceNum - prevNum) * 100) / 100;
            const pct = ((change / prevNum) * 100).toFixed(2);
            changePercent = `${change >= 0 ? '+' : ''}${pct}%`;
          }
        }

        return {
          code: cleanCode,
          name: resolvedName,
          currentPrice: priceNum,
          change,
          changePercent,
          market,
          currency,
          updatedAt: nowTime,
          isRealtime: true,
        };
      }
    }
  } catch (err) {
    console.warn('FinMind 抓取失敗，嘗試備援管道:', err);
  }

  // 2. 原生 App 環境備援：Yahoo Finance 直連查詢 (無 CORS 限制)
  if (Platform.OS !== 'web') {
    const symbol = market === 'TW' ? `${cleanCode}.TW` : cleanCode;
    const yahooData = await fetchYahooNative(symbol);
    if (yahooData && yahooData.price > 0) {
      return {
        code: cleanCode,
        name: popular ? popular.name : (yahooData.name || defaultName),
        currentPrice: yahooData.price,
        change: yahooData.change,
        changePercent: yahooData.changePercent,
        market,
        currency,
        updatedAt: nowTime,
        isRealtime: true,
      };
    }

    // 針對台股再試證交所 MIS
    if (market === 'TW') {
      const misData = await fetchTwseMisNative(cleanCode);
      if (misData && misData.price > 0) {
        return {
          code: cleanCode,
          name: misData.name || defaultName,
          currentPrice: misData.price,
          change: misData.change,
          changePercent: misData.changePercent,
          market,
          currency,
          updatedAt: nowTime,
          isRealtime: true,
        };
      }
    }
  }

  // 3. 備援預設：若為熱門股票標的，保留代號與有名稱支援
  return {
    code: cleanCode,
    name: defaultName,
    currentPrice: 0,
    market,
    currency,
    updatedAt: nowTime,
    isRealtime: false,
  };
}

/**
 * 批量更新持股的所有即時市價 (平滑分批查詢，避免觸發 API 頻率限制)
 */
export async function fetchMultipleStockQuotes(codes: string[]): Promise<Record<string, StockQuote>> {
  const uniqueCodes = Array.from(new Set(codes.map(c => c.trim().toUpperCase()))).filter(Boolean);
  const results: Record<string, StockQuote> = {};
  if (uniqueCodes.length === 0) return results;

  // 每批最多 3 檔股票並行，批次間微幅暫停，維持連線穩定度
  const batchSize = 3;
  for (let i = 0; i < uniqueCodes.length; i += batchSize) {
    const batch = uniqueCodes.slice(i, i + batchSize);
    const promises = batch.map(async (code) => {
      try {
        const quote = await fetchStockQuote(code);
        if (quote && quote.currentPrice > 0) {
          results[quote.code] = quote;
        }
      } catch (e) {
        console.warn(`更新 ${code} 失敗:`, e);
      }
    });

    await Promise.allSettled(promises);
    if (i + batchSize < uniqueCodes.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return results;
}

/**
 * 取得最新美元兌台幣匯率 (公開可靠多來源，免 CORS Proxy)
 */
export async function getUsdToTwdRate(): Promise<number> {
  // 1. 公開匯率 API (全球高可用、無須 Key、CORS 開放)
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', {}, 4000);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.TWD;
      if (typeof rate === 'number' && rate > 0) {
        return Math.round(rate * 100) / 100;
      }
    }
  } catch {}

  // 2. 備援：ExchangeRate-API
  try {
    const res = await fetchWithTimeout('https://api.exchangerate-api.com/v4/latest/USD', {}, 4000);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.TWD;
      if (typeof rate === 'number' && rate > 0) {
        return Math.round(rate * 100) / 100;
      }
    }
  } catch {}

  // 3. 原生環境可直接查詢 Yahoo Finance
  if (Platform.OS !== 'web') {
    try {
      const yahooData = await fetchYahooNative('USDTWD=X');
      if (yahooData && yahooData.price > 0) {
        return Math.round(yahooData.price * 100) / 100;
      }
    } catch {}
  }

  return 32.4;
}
