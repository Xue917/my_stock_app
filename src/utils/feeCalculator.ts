// src/utils/feeCalculator.ts
import { BrokerConfig, HoldingItem } from '../types';

/**
 * 判斷股票是否為 ETF (台股代號為 00 開頭，例如 0050、0056、00878、00919、00929)
 */
export function isETFCode(code: string): boolean {
  if (!code) return false;
  const clean = code.trim().toUpperCase().replace('.TW', '').replace('.TWO', '');
  return clean.startsWith('00');
}

/**
 * 判斷是否為債券型 ETF (例如 00679B、00687B、00937B 等，代號以 B 結尾)
 */
export function isBondETFCode(code: string): boolean {
  if (!code) return false;
  const clean = code.trim().toUpperCase().replace('.TW', '').replace('.TWO', '');
  return clean.startsWith('00') && clean.endsWith('B');
}

/**
 * 根據大數據法規精準取得證券交易稅率 (Tax Rate)
 * - 一般股票：0.3% (0.003)
 * - 現股當沖：0.15% (0.0015)
 * - 股票型 ETF (如 0050, 0056)：法定減徵至 0.1% (0.001)
 * - 債券型 ETF (如 00679B)：法定免徵 0% (0.000)
 * - 美股：免徵台灣證券交易稅 0%
 */
export function getTaxRate(code: string, isDayTrade: boolean = false, market: 'TW' | 'US' = 'TW'): number {
  if (market === 'US') return 0;
  if (isBondETFCode(code)) return 0;
  if (isETFCode(code)) return 0.001; // 🎯 ETF 證交稅為千分之一 (0.1%)
  if (isDayTrade) return 0.0015;      // 當沖減半為千分之 1.5 (0.15%)
  return 0.003;                      // 一般股票為千分之 3 (0.3%)
}

/**
 * 計算買進手續費 (精準支援定期定額 DCA 優惠、零股低消 1 元、整股低消)
 */
export function calculateBuyFee(params: {
  amount: number;
  shares: number;
  broker: BrokerConfig;
  isDCA?: boolean;
  market?: 'TW' | 'US';
}): { discountedFee: number; originalFee: number; rebateAmount: number } {
  const { amount, shares, broker, isDCA, market } = params;
  if (market === 'US') {
    return { discountedFee: 0, originalFee: 0, rebateAmount: 0 };
  }

  const rawFee = amount * 0.001425;
  const isOddLot = shares < 1000 || shares % 1000 !== 0;

  // 🎯 定期定額 (DCA) 存股手續費專案：各大券商扣款 1 萬元內，均一價只要 1 元！
  if (isDCA) {
    const threshold = broker.dcaThreshold || 10000;
    const dcaMin = broker.dcaMinFee || 1;
    let discountedFee = dcaMin;
    if (amount > threshold) {
      discountedFee = Math.max(Math.floor(rawFee * broker.discount), dcaMin);
    }
    const originalFee = Math.max(Math.floor(rawFee), 1);
    const rebateAmount = Math.max(0, originalFee - discountedFee);
    return { discountedFee, originalFee, rebateAmount };
  }

  // 🎯 一般交易：零股 vs 整股
  // 全台主流券商（國泰、富邦、永豐金、元大、凱基、富果等）盤中/盤後零股低消皆為 1 元！
  const minFee = isOddLot ? (broker.oddLotMinFee || 1) : (broker.minFee || 20);
  const discountedFee = Math.max(Math.floor(rawFee * broker.discount), minFee);
  const originalFee = isOddLot ? Math.max(Math.floor(rawFee), 1) : Math.max(Math.floor(rawFee), 20);
  const rebateAmount = Math.max(0, originalFee - discountedFee);

  return { discountedFee, originalFee, rebateAmount };
}

/**
 * 計算賣出手續費與證券交易稅
 */
export function calculateSellFeeAndTax(params: {
  code: string;
  amount: number;
  shares: number;
  broker: BrokerConfig;
  isDayTrade?: boolean;
  market?: 'TW' | 'US';
}): {
  tax: number;
  taxRate: number;
  discountedFee: number;
  originalFee: number;
  rebateAmount: number;
} {
  const { code, amount, shares, broker, isDayTrade = false, market = 'TW' } = params;

  if (market === 'US') {
    return {
      tax: 0,
      taxRate: 0,
      discountedFee: 0,
      originalFee: 0,
      rebateAmount: 0,
    };
  }

  const taxRate = getTaxRate(code, isDayTrade, market);
  const tax = Math.floor(amount * taxRate);

  const rawFee = amount * 0.001425;
  const isOddLot = shares < 1000 || shares % 1000 !== 0;
  const minFee = isOddLot ? (broker.oddLotMinFee || 1) : (broker.minFee || 20);

  const discountedFee = Math.max(Math.floor(rawFee * broker.discount), minFee);
  const originalFee = isOddLot ? Math.max(Math.floor(rawFee), 1) : Math.max(Math.floor(rawFee), 20);
  const rebateAmount = Math.max(0, originalFee - discountedFee);

  return {
    tax,
    taxRate,
    discountedFee,
    originalFee,
    rebateAmount,
  };
}

/**
 * 精準計算持股的未實現淨損益 (對齊券商實質損益畫面)
 */
export function calculateHoldingUnrealized(item: HoldingItem, broker: BrokerConfig, usdRate: number = 32.4) {
  const isUS = item.currency === 'USD' || item.market === 'US';
  const shares = item.shares;
  const avgCost = item.avgCost;
  const currentPrice = item.currentPrice;

  if (shares <= 0 || avgCost <= 0 || currentPrice <= 0) {
    return {
      totalVal: 0,
      totalCost: 0,
      pl: 0,
      netProfitTwd: 0,
      roi: 0,
      tax: 0,
      taxRate: 0,
      buyFee: 0,
      sellFee: 0,
      isETF: false,
    };
  }

  if (isUS) {
    const totalVal = shares * currentPrice;
    const totalCost = shares * avgCost;
    const pl = totalVal - totalCost;
    const roi = totalCost > 0 ? (pl / totalCost) * 100 : 0;
    return {
      totalVal,
      totalCost,
      pl,
      netProfitTwd: pl * usdRate,
      roi,
      tax: 0,
      taxRate: 0,
      buyFee: 0,
      sellFee: 0,
      isETF: false,
    };
  }

  const buyAmount = shares * avgCost;
  const currentMarketVal = shares * currentPrice;

  // 1. 買進手續費 (考量是否為定期定額 DCA)
  const { discountedFee: buyFee } = calculateBuyFee({
    amount: buyAmount,
    shares,
    broker,
    isDCA: item.isDCA,
    market: 'TW',
  });
  const totalCost = buyAmount + buyFee;

  // 2. 預估賣出費用 (考量 ETF 0.1% 優惠稅率與零股低消 1 元)
  const isETF = isETFCode(item.code);
  const { tax, taxRate, discountedFee: sellFee } = calculateSellFeeAndTax({
    code: item.code,
    amount: currentMarketVal,
    shares,
    broker,
    isDayTrade: false,
    market: 'TW',
  });

  const netSellAmount = currentMarketVal - sellFee - tax;
  const pl = netSellAmount - totalCost;
  const roi = totalCost > 0 ? (pl / totalCost) * 100 : 0;

  return {
    totalVal: currentMarketVal,
    totalCost,
    pl,
    netProfitTwd: pl,
    roi,
    tax,
    taxRate,
    buyFee,
    sellFee,
    isETF,
  };
}

/**
 * 判斷歷史交易的手續費折讓款（日退 / 月退）是否已到達撥款退回時間
 * - instant (現折)：交易當下已直接折讓，無需後續退款
 * - daily (日退)：次營業日入帳。若當前日期晚於賣出日期（T+1或之後），判定為已到期可退回資產
 * - monthly (月退)：次月固定日入帳。若當前月份已晚於賣出月份（或隔年），判定為已到期可退回資產
 */
export function isTradeRebateDue(trade: {
  isRebated?: boolean;
  rebateAmount?: number;
  rebateType?: 'instant' | 'daily' | 'monthly';
  sellDate?: string;
}): boolean {
  if (trade.isRebated || !trade.rebateAmount || trade.rebateAmount <= 0) {
    return false;
  }
  if (trade.rebateType === 'instant') {
    return false;
  }
  if (!trade.sellDate) return false;

  const datePart = trade.sellDate.split(' ')[0]; // YYYY-MM-DD
  const tradeDate = new Date(datePart);
  if (isNaN(tradeDate.getTime())) return false;

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tradeMidnight = new Date(tradeDate.getFullYear(), tradeDate.getMonth(), tradeDate.getDate());

  if (trade.rebateType === 'daily') {
    // 日退：當前日期晚於賣出日期即到期
    return todayMidnight.getTime() > tradeMidnight.getTime();
  }

  if (trade.rebateType === 'monthly') {
    // 月退：跨月或跨年即到期
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    const tradeYear = tradeDate.getFullYear();
    const tradeMonth = tradeDate.getMonth();

    if (nowYear > tradeYear) return true;
    if (nowYear === tradeYear && nowMonth > tradeMonth) return true;

    // 若相距已超過 28 天以上
    const diffDays = (todayMidnight.getTime() - tradeMidnight.getTime()) / (1000 * 3600 * 24);
    if (diffDays >= 28) return true;

    return false;
  }

  return false;
}
