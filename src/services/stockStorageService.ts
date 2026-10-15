// src/services/stockStorageService.ts
import { supabase } from './supabase';
import { HoldingItem, RealizedTrade } from '../types';

/**
 * 從 Supabase 載入使用者的所有持股資料
 */
export async function fetchHoldingsFromSupabase(userId: string): Promise<HoldingItem[]> {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.warn('載入 Supabase 持股失敗:', error.message);
    return [];
  }

  // 將資料庫蛇形命名 (snake_case) 轉換為前端駝峰命名 (camelCase)
  return (data || []).map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    shares: Number(item.shares),
    avgCost: Number(item.avg_cost),
    currentPrice: Number(item.current_price),
    buyDate: item.buy_date,
    market: item.market,
    currency: item.currency,
    isDCA: item.is_dca,
    lastUpdated: item.last_updated,
  }));
}

/**
 * 儲存或更新單筆持股至 Supabase
 */
export async function saveHoldingToSupabase(userId: string, item: HoldingItem) {
  const { error } = await supabase
    .from('holdings')
    .upsert({
      id: item.id,
      user_id: userId,
      code: item.code,
      name: item.name,
      shares: item.shares,
      avg_cost: item.avgCost,
      current_price: item.currentPrice,
      buy_date: item.buyDate,
      market: item.market,
      currency: item.currency,
      is_dca: item.isDCA || false,
      last_updated: item.lastUpdated || '',
    });

  if (error) {
    console.warn('儲存持股至 Supabase 失敗:', error.message);
  }
}

/**
 * 從 Supabase 刪除持股
 */
export async function deleteHoldingFromSupabase(id: string) {
  const { error } = await supabase
    .from('holdings')
    .delete()
    .eq('id', id);

  if (error) {
    console.warn('刪除 Supabase 持股失敗:', error.message);
  }
}

/**
 * 從 Supabase 載入歷史已實現交易紀錄
 */
export async function fetchTradesFromSupabase(userId: string): Promise<RealizedTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('sell_date', { ascending: false });

  if (error) {
    console.warn('載入 Supabase 歷史紀錄失敗:', error.message);
    return [];
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    buyDate: item.buy_date,
    sellDate: item.sell_date,
    shares: Number(item.shares),
    buyPrice: Number(item.buy_price),
    sellPrice: Number(item.sell_price),
    isDayTrade: item.is_day_trade,
    netProfit: Number(item.net_profit),
    market: item.market,
    currency: item.currency,
    isDCA: item.is_dca,
    isETF: item.is_etf,
    taxRate: Number(item.tax_rate),
    brokerId: item.broker_id,
    brokerName: item.broker_name,
    grossRevenue: Number(item.gross_revenue),
    tax: Number(item.tax),
    originalSellFee: Number(item.original_sell_fee),
    discountedSellFee: Number(item.discounted_sell_fee),
    rebateAmount: Number(item.rebate_amount),
    rebateType: item.rebate_type,
    rebateDesc: item.rebate_desc,
    isRebated: item.is_rebated,
  }));
}

/**
 * 新增歷史成交紀錄至 Supabase
 */
export async function saveTradeToSupabase(userId: string, item: RealizedTrade) {
  const { error } = await supabase
    .from('trades')
    .upsert({
      id: item.id,
      user_id: userId,
      code: item.code,
      name: item.name,
      buy_date: item.buyDate,
      sell_date: item.sellDate,
      shares: item.shares,
      buy_price: item.buyPrice,
      sell_price: item.sellPrice,
      is_day_trade: item.isDayTrade || false,
      net_profit: item.netProfit,
      market: item.market,
      currency: item.currency,
      is_dca: item.isDCA || false,
      is_etf: item.isETF || false,
      tax_rate: item.taxRate || 0,
      broker_id: item.brokerId || '',
      broker_name: item.brokerName || '',
      gross_revenue: item.grossRevenue || 0,
      tax: item.tax || 0,
      original_sell_fee: item.originalSellFee || 0,
      discounted_sell_fee: item.discountedSellFee || 0,
      rebate_amount: item.rebateAmount || 0,
      rebate_type: item.rebateType || '',
      rebate_desc: item.rebateDesc || '',
      is_rebated: item.isRebated || false,
    });

  if (error) {
    console.warn('儲存歷史紀錄至 Supabase 失敗:', error.message);
  }
}