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
  '8069': { name: '元太', market: 'TW', currency: 'TWD' },
  '3443': { name: '創意', market: 'TW', currency: 'TWD' },
  '3661': { name: '世芯-KY', market: 'TW', currency: 'TWD' },
  '3008': { name: '大立光', market: 'TW', currency: 'TWD' },
  '2412': { name: '中華電', market: 'TW', currency: 'TWD' },

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
  'SOXX': { name: '費城半導體 ETF (SOXX)', market: 'US', currency: 'USD' },
};

/**
 * 判斷股票代號為台股或美股
 */
export function detectStockMarket(code: string): { market: 'TW' | 'US'; currency: 'TWD' | 'USD'; cleanCode: string } {
  const trimmed = code.trim().toUpperCase();
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
 * 抓取單支股票即時報價 (支援台股與美股全市場)
 */
export async function fetchStockQuote(rawCode: string): Promise<StockQuote | null> {
  if (!rawCode || !rawCode.trim()) return null;

  const { market, currency, cleanCode } = detectStockMarket(rawCode);
  const popular = POPULAR_STOCKS[cleanCode];
  let defaultName = popular ? popular.name : cleanCode;
  const startDate = getLookupStartDate();
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  // 1. 嘗試由 FinMind API (支援跨域 CORS，涵蓋全台股與全美股)
  try {
    const isTw = market === 'TW';
    const infoDataset = isTw ? 'TaiwanStockInfo' : 'USStockInfo';
    const priceDataset = isTw ? 'TaiwanStockPrice' : 'USStockPrice';

    const infoUrl = `https://api.finmindtrade.com/api/v4/data?dataset=${infoDataset}&data_id=${cleanCode}`;
    const priceUrl = `https://api.finmindtrade.com/api/v4/data?dataset=${priceDataset}&data_id=${cleanCode}&start_date=${startDate}`;

    const [infoRes, priceRes] = await Promise.all([
      fetch(infoUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(priceUrl).then(r => r.ok ? r.json() : null).catch(() => null),
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
      const lastItem = priceRes.data[priceRes.data.length - 1];
      const rawPrice = lastItem.close ?? lastItem.Close ?? lastItem.Adj_Close;
      const priceNum = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);

      if (!isNaN(priceNum) && priceNum > 0) {
        const spread = lastItem.spread;
        let changePercent = '';
        if (typeof spread === 'number' && priceNum - spread > 0) {
          const prev = priceNum - spread;
          const pct = ((spread / prev) * 100).toFixed(2);
          changePercent = `${spread >= 0 ? '+' : ''}${pct}%`;
        }

        return {
          code: cleanCode,
          name: resolvedName,
          currentPrice: priceNum,
          change: typeof spread === 'number' ? spread : undefined,
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

  // 2. 備援：Yahoo Finance (透過 CORS Proxy 繞過跨網域限制)[cite: 8]
  try {
    const symbol = market === 'TW' ? `${cleanCode}.TW` : cleanCode;
    const rawYahooUrl = `https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;fields=avgPrice,change,changePercent,marketStatus,name,price,symbol;symbols=${symbol}`;
    const yahooUrl = `https://corsproxy.io/?${encodeURIComponent(rawYahooUrl)}`;

    const response = await fetch(yahooUrl);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && data[0]?.price?.raw) {
        const item = data[0];
        const p = parseFloat(item.price.raw);
        if (!isNaN(p) && p > 0) {
          return {
            code: cleanCode,
            name: item.symbolName || defaultName,
            currentPrice: p,
            change: item.change?.raw ? parseFloat(item.change.raw) : undefined,
            changePercent: item.changePercent || '',
            market,
            currency,
            updatedAt: nowTime,
            isRealtime: true,
          };
        }
      }
    }
  } catch (err) {
    console.warn('Yahoo 備援抓取失敗:', err);
  }

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
 * 批量更新持股的所有即時市價
 */
export async function fetchMultipleStockQuotes(codes: string[]): Promise<Record<string, StockQuote>> {
  const uniqueCodes = Array.from(new Set(codes.map(c => c.trim().toUpperCase())));
  const results: Record<string, StockQuote> = {};

  const promises = uniqueCodes.map(async (code) => {
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
  return results;
}

/**
 * 取得最新美元兌台幣匯率 (透過 CORS Proxy 繞過跨網域限制)[cite: 8]
 */
export async function getUsdToTwdRate(): Promise<number> {
  try {
    const rawUrl = 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;fields=avgPrice,price,symbol;symbols=USDTWD=X';
    const url = `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`;
    
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.price?.raw) {
        const rate = parseFloat(data[0].price.raw);
        if (!isNaN(rate) && rate > 0) return rate;
      }
    }
  } catch (e) {
    // 靜默 fallback
  }
  return 32.4;
}