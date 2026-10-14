// src/types/index.ts
export interface BrokerConfig {
  id: string;
  name: string;
  discount: number;
  minFee: number;
}

export interface HoldingItem {
  id: string;
  code: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
}

export interface RealizedTrade {
  id: string;
  code: string;
  name: string;
  sellDate: string;
  shares: number;
  buyPrice: number;
  sellPrice: number;
  isDayTrade: boolean;
  netProfit: number; // 淨損益（正數為賺，負數為賠）
}