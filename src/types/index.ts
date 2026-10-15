// src/types/index.ts

export type RebateType = 'instant' | 'daily' | 'monthly';

export interface BrokerConfig {
  id: string;
  name: string;
  shortName: string;
  discount: number;
  minFee: number; // 整股低消
  oddLotMinFee: number; // 零股低消 (全台普遍 1 元)
  dcaMinFee: number; // 定期定額手續費低消 (1 元均一價)
  dcaThreshold: number; // 定期定額均一價門檻 (例如 10,000 元)
  rebateType: RebateType; // 'instant' 現折 | 'daily' 日退 | 'monthly' 月退
  rebateDayDesc: string; // 退佣時間描述
  description: string;
}

export interface HoldingItem {
  id: string;
  code: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  buyDate?: string; // 購入日期時間 (YYYY-MM-DD HH:mm)
  market?: 'TW' | 'US';
  currency?: 'TWD' | 'USD';
  isDCA?: boolean; // 🎯 是否為定期定額買進 (享手續費 1 元優惠)
  lastUpdated?: string;
}

export interface RealizedTrade {
  id: string;
  code: string;
  name: string;
  buyDate?: string;
  sellDate: string;
  shares: number;
  buyPrice: number;
  sellPrice: number;
  isDayTrade: boolean;
  netProfit: number; // 淨損益（正數為賺，負數為賠）
  market?: 'TW' | 'US';
  currency?: 'TWD' | 'USD';
  isDCA?: boolean; // 是否為定期定額部位
  isETF?: boolean; // 是否為 ETF (享 0.1% 優惠稅率)
  taxRate?: number; // 實施之證交稅率
  
  // 各券商手續費與退佣詳細紀錄
  brokerId?: string;
  brokerName?: string;
  grossRevenue?: number; // 賣出總金額 (sellPrice * shares)
  tax?: number; // 證交稅
  originalSellFee?: number; // 先扣牌告手續費
  discountedSellFee?: number; // 實際折讓手續費
  rebateAmount?: number; // 退回手續費折讓金
  rebateType?: RebateType; // 現折 / 日退 / 月退
  rebateDesc?: string;
  isRebated?: boolean; // 是否已加回/撥入資產
}