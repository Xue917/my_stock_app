// src/screens/DashboardScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity, 
  Modal, 
  Pressable, 
  TextInput, 
  ActivityIndicator,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HoldingItem, RealizedTrade, BrokerConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import { BROKER_OPTIONS } from '../data/brokers';
import { 
  fetchStockQuote as originalFetchStockQuote, 
  fetchMultipleStockQuotes as originalFetchMultipleStockQuotes, 
  getUsdToTwdRate as originalGetUsdToTwdRate, 
  detectStockMarket, 
  POPULAR_STOCKS 
} from '../services/stockService';
import {
  fetchHoldingsFromSupabase,
  saveHoldingToSupabase,
  saveMultipleHoldingsToSupabase,
  deleteHoldingFromSupabase,
  fetchTradesFromSupabase,
  saveTradeToSupabase,
  deleteTradeFromSupabase,
} from '../services/stockStorageService';
import {
  isETFCode,
  calculateBuyFee,
  calculateSellFeeAndTax,
  calculateHoldingUnrealized,
  isTradeRebateDue,
} from '../utils/feeCalculator';

// 🛡️ 安全取得即時美元兌台幣匯率 (由多來源無 CORS 限制端點提供)
async function safeGetUsdToTwdRate(): Promise<number> {
  try {
    const rate = await originalGetUsdToTwdRate();
    if (rate && rate > 0) return rate;
  } catch (e) {
    console.warn('originalGetUsdToTwdRate failed, fallback to 32.4:', e);
  }
  return 32.4; // 預設安全匯率
}

async function safeFetchStockQuote(symbol: string) {
  try {
    const quote = await originalFetchStockQuote(symbol);
    if (quote && quote.currentPrice > 0) return quote;
  } catch (e) {
    console.warn('originalFetchStockQuote failed:', e);
  }
  return null;
}

async function safeFetchMultipleStockQuotes(symbols: string[]) {
  try {
    const quotes = await originalFetchMultipleStockQuotes(symbols);
    if (quotes && Object.keys(quotes).length > 0) return quotes;
  } catch (e) {
    console.warn('originalFetchMultipleStockQuotes failed:', e);
  }
  return {};
}

// 判斷指定 YYYY-MM-DD 日期在美國是否為夏令時間 (Daylight Saving Time)
export function isUSDaylightSaving(dateStr: string): boolean {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;

  const year = d.getFullYear();
  
  // 3月第二個星期日
  const marchFirst = new Date(year, 2, 1);
  const dstStartDay = (7 - marchFirst.getDay()) % 7 + 8;
  const dstStart = new Date(year, 2, dstStartDay, 2, 0, 0);

  // 11月第一個星期日
  const novFirst = new Date(year, 10, 1);
  const dstEndDay = (7 - novFirst.getDay()) % 7 + 1;
  const dstEnd = new Date(year, 10, dstEndDay, 2, 0, 0);

  return d >= dstStart && d < dstEnd;
}

// 取得可用的小時選項列表 (首項為 NULL 未指定)
export function getTradingHourOptions(market: 'TW' | 'US', dateStr: string): { label: string; value: string }[] {
  const hours: { label: string; value: string }[] = [
    { label: '-- 時', value: '' }
  ];
  if (market === 'TW') {
    for (let h = 9; h <= 14; h++) {
      const hStr = String(h).padStart(2, '0');
      let label = `${hStr} 時`;
      if (h === 9) label = '09 時 (開盤)';
      else if (h === 13) label = '13 時 (收盤)';
      else if (h === 14) label = '14 時 (盤後只到30分)';
      hours.push({ label, value: hStr });
    }
  } else {
    const isDST = isUSDaylightSaving(dateStr);
    const startH = isDST ? 21 : 22;
    const endH = isDST ? 4 : 5;

    let h = startH;
    while (true) {
      const hStr = String(h).padStart(2, '0');
      let label = `${hStr} 時`;
      if (h === 21) label = '21 時 (夏令開盤)';
      else if (h === 22) label = '22 時 (冬令開盤)';
      else if (h === 4) label = '04 時 (夏令收盤)';
      else if (h === 5) label = '05 時 (冬令收盤)';
      else if (h === 0) label = '00 時 (午夜)';

      hours.push({ label, value: hStr });
      if (h === endH) break;
      h = (h + 1) % 24;
    }
  }
  return hours;
}

// 取得指定小時內的分鐘選項 (00 ~ 59，首項為 NULL 未指定)
export function getTradingMinuteOptions(market: 'TW' | 'US', dateStr: string, hourStr: string): { label: string; value: string }[] {
  const minutes: { label: string; value: string }[] = [
    { label: '-- 分', value: '' }
  ];

  if (!hourStr) {
    return minutes;
  }

  const hNum = parseInt(hourStr, 10);

  for (let m = 0; m < 60; m++) {
    const mStr = String(m).padStart(2, '0');
    
    if (market === 'TW') {
      if (hNum === 14 && m > 30) break;
    } else {
      const isDST = isUSDaylightSaving(dateStr);
      const startH = isDST ? 21 : 22;
      const startM = 30;
      const endH = isDST ? 4 : 5;
      const endM = 0;

      if (hNum === startH && m < startM) continue;
      if (hNum === endH && m > endM) break;
    }

    minutes.push({ label: `${mStr} 分`, value: mStr });
  }

  return minutes;
}

// 驗證輸入的時間是否符合台股/美股的合法交易時間 (支援空值 NULL 略過驗證)
export function validateTradingTime(market: 'TW' | 'US', dateStr: string, hourStr: string, minuteStr: string): { isValid: boolean; errorMsg: string; isWarning?: boolean } {
  if (!hourStr || !minuteStr) {
    return { isValid: true, errorMsg: '' };
  }

  const h = parseInt(hourStr, 10);
  const m = parseInt(minuteStr, 10);

  if (isNaN(h) || isNaN(m)) {
    return { isValid: false, errorMsg: '❌ 請輸入有效的時間數字！' };
  }

  if (market === 'TW') {
    if (h < 9 || h > 14) {
      return { isValid: false, errorMsg: '⚠️ 【台股時間錯誤】台股正常交易與盤後時間為 09:00 至 14:30，請重新輸入正確的小時！' };
    }
    if (h === 14 && m > 30) {
      return { isValid: false, errorMsg: '⚠️ 【台股時間錯誤】台股盤後只到 14:30，14:30 後已完全收盤！' };
    }
    if (h < 9) {
      return { isValid: false, errorMsg: '⚠️ 【台股尚未開盤】台股開盤時間為 09:00，此時段尚未開盤！' };
    }
    if (h === 13 && m > 30) {
      return { isValid: true, errorMsg: '💡 【貼心提醒】13:30 後為台股收盤後的盤後定價 / 盤後零股交易時段。' };
    }
    if (h === 14) {
      return { isValid: true, errorMsg: '💡 【貼心提醒】您目前選擇的是 14:00 後的台股盤後交易時段。' };
    }
  } else {
    const isDST = isUSDaylightSaving(dateStr);
    const startH = isDST ? 21 : 22;
    const startM = 30;
    const endH = isDST ? 4 : 5;
    const endM = 0;

    const totalM = h * 60 + m;
    const startTotalM = startH * 60 + startM;
    const endTotalM = endH * 60 + endM;

    const isInRange = totalM >= startTotalM || totalM <= endTotalM;

    if (!isInRange) {
      const seasonStr = isDST ? '夏令' : '冬令';
      const openTimeStr = isDST ? '21:30' : '22:30';
      const closeTimeStr = isDST ? '04:00' : '05:00';
      return { 
        isValid: false, 
        errorMsg: `⚠️ 【美股時間不符】(${seasonStr}時間) 美股開盤時間為 ${openTimeStr} 至隔日 ${closeTimeStr}，請重新輸入符合的買賣時間！` 
      };
    }
  }

  return { isValid: true, errorMsg: '' };
}

// 流水帳單筆明細型態定義
export interface LedgerEntry {
  id: string;
  tradeId: string;
  date: string;
  type: 'SELL_REVENUE' | 'FEE' | 'TAX' | 'REBATE' | 'DIVIDEND';
  typeName: string;
  code: string;
  name: string;
  amount: number;
  note: string;
}

// 股票部位統計與彙整卡片型態定義
export interface StockSummaryGroup {
  code: string;
  name: string;
  market: 'TW' | 'US';
  currency: 'TWD' | 'USD';
  buyCount: number;
  totalShares: number;
  totalCost: number;
  avgCost: number;
  currentPrice: number;
  totalVal: number;
  unrealizedPl: number;
  roi: number;
  holdingsList: HoldingItem[];
}

export default function DashboardScreen({ route }: { route?: any }) {
  const { user, profile, signOut, updateGoalMilestone, updateDefaultBroker } = useAuth();
  
  const [tab, setTab] = useState<'holdings' | 'history'>('holdings');
  const [ledgerFullScreenVisible, setLedgerFullScreenVisible] = useState<boolean>(false);
  
  const [ledgerTimeRange, setLedgerTimeRange] = useState<'7d' | '1m' | '3m' | '6m' | '1y' | '5y' | '10y' | 'custom'>('7d');
  
  const getTodayTaiwanStr = () => {
    try {
      const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
      const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(new Date());
      const y = parts.find(p => p.type === 'year')?.value || '2026';
      const m = parts.find(p => p.type === 'month')?.value || '10';
      const d = parts.find(p => p.type === 'day')?.value || '15';
      return `${y}-${m}-${d}`;
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  };

  const todayTaiwanStr = getTodayTaiwanStr();
  const [customStartDate, setCustomStartDate] = useState<string>('2000-01-01');
  const [customEndDate, setCustomEndDate] = useState<string>(todayTaiwanStr);

  useEffect(() => {
    const timer = setInterval(() => {
      const currentToday = getTodayTaiwanStr();
      if (currentToday !== customEndDate && ledgerTimeRange === 'custom') {
        setCustomEndDate(currentToday);
      }
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [customEndDate, ledgerTimeRange]);

  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [recordExplainModalVisible, setRecordExplainModalVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [sellModalVisible, setSellModalVisible] = useState(false);
  const [dividendModalVisible, setDividendModalVisible] = useState(false);

  const [selectedFilterCode, setSelectedFilterCode] = useState<string | null>(null);
  const [selectedHistoryFilterCode, setSelectedHistoryFilterCode] = useState<string | null>(null);

  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(profile?.defaultBrokerId || 'cathay');
  const currentBroker: BrokerConfig = BROKER_OPTIONS.find((b) => b.id === selectedBrokerId) || BROKER_OPTIONS[0];

  useEffect(() => {
    if (route?.params?.openSettings) {
      setSettingsModalVisible(true);
    }
  }, [route?.params]);

  const [cash, setCash] = useState<number>(0);
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [historyTrades, setHistoryTrades] = useState<RealizedTrade[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [usdRate, setUsdRate] = useState<number>(32.4);
  const [isRefreshingAll, setIsRefreshingAll] = useState<boolean>(false);
  const [lastRefreshedTime, setLastRefreshedTime] = useState<string>('');
  const [rebateSuccessMsg, setRebateSuccessMsg] = useState<string>('');

  // 領股息輸入相關狀態
  const [dividendPerShareInput, setDividendPerShareInput] = useState('');
  const [dividendDateInput, setDividendDateInput] = useState(todayTaiwanStr);
  const [dividendErrorMsg, setDividendErrorMsg] = useState('');

  const getStorageKey = (prefix: string) => `@mystock_${prefix}_${user?.id || 'guest'}`;

  const rebuildLedgerEntries = (trades: RealizedTrade[], customDividends?: LedgerEntry[]) => {
    const entries: LedgerEntry[] = customDividends ? [...customDividends.filter(e => e.type === 'DIVIDEND')] : [];
    
    trades.forEach(t => {
      const isUS = t.currency === 'USD' || t.market === 'US';
      const sym = isUS ? '$' : 'NT$';

      entries.push({
        id: `${t.id}_rev`,
        tradeId: t.id,
        date: t.sellDate,
        type: 'SELL_REVENUE',
        typeName: '股票賣出交割',
        code: t.code,
        name: t.name,
        amount: t.grossRevenue || (t.sellPrice * t.shares),
        note: `賣出 ${t.shares.toLocaleString()} 股 @ ${sym}${t.sellPrice.toLocaleString()}`
      });

      const fee = t.discountedSellFee || t.originalSellFee || 0;
      if (fee > 0) {
        entries.push({
          id: `${t.id}_fee`,
          tradeId: t.id,
          date: t.sellDate,
          type: 'FEE',
          typeName: '券商手續費',
          code: t.code,
          name: t.name,
          amount: -Math.abs(fee),
          note: `套用 ${t.brokerName || '券商'} 折扣`
        });
      }

      if (t.tax && t.tax > 0) {
        entries.push({
          id: `${t.id}_tax`,
          tradeId: t.id,
          date: t.sellDate,
          type: 'TAX',
          typeName: '證券交易稅',
          code: t.code,
          name: t.name,
          amount: -Math.abs(t.tax),
          note: `稅率 ${(t.taxRate ? t.taxRate * 100 : 0.3).toFixed(2)}%`
        });
      }

      if (t.isRebated && t.rebateAmount && t.rebateAmount > 0) {
        entries.push({
          id: `${t.id}_rebate`,
          tradeId: t.id,
          date: t.sellDate,
          type: 'REBATE',
          typeName: '手續費退佣折讓',
          code: t.code,
          name: t.name,
          amount: t.rebateAmount,
          note: `退回資產 (${t.rebateDesc || '折讓款'})`
        });
      }
    });

    setLedgerEntries(entries);
  };

  const filteredLedgerEntries = useMemo(() => {
    if (ledgerTimeRange === '10y') return ledgerEntries;

    if (ledgerTimeRange === 'custom') {
      return ledgerEntries.filter(entry => {
        const datePart = (entry.date || '').split(' ')[0];
        if (!datePart) return true;
        return datePart >= customStartDate && datePart <= customEndDate;
      });
    }

    const now = new Date();
    const cutoffDate = new Date();

    if (ledgerTimeRange === '7d') {
      cutoffDate.setDate(now.getDate() - 7);
    } else if (ledgerTimeRange === '1m') {
      cutoffDate.setMonth(now.getMonth() - 1);
    } else if (ledgerTimeRange === '3m') {
      cutoffDate.setMonth(now.getMonth() - 3);
    } else if (ledgerTimeRange === '6m') {
      cutoffDate.setMonth(now.getMonth() - 6);
    } else if (ledgerTimeRange === '1y') {
      cutoffDate.setFullYear(now.getFullYear() - 1);
    } else if (ledgerTimeRange === '5y') {
      cutoffDate.setFullYear(now.getFullYear() - 5);
    }

    return ledgerEntries.filter(entry => {
      const datePart = (entry.date || '').split(' ')[0];
      const entryDate = new Date(datePart);
      if (isNaN(entryDate.getTime())) return true;
      return entryDate >= cutoffDate;
    });
  }, [ledgerEntries, ledgerTimeRange, customStartDate, customEndDate]);

  const groupedLedgerEntries = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    filteredLedgerEntries.forEach((entry) => {
      const datePart = (entry.date || '').split(' ')[0] || '未分類日期';
      if (!map.has(datePart)) {
        map.set(datePart, []);
      }
      map.get(datePart)!.push(entry);
    });

    const sortedDays = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
    return sortedDays.map((day) => ({
      day,
      entries: map.get(day)!.sort((a, b) => b.date.localeCompare(a.date)),
    }));
  }, [filteredLedgerEntries]);

  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const savedHoldings = await AsyncStorage.getItem(getStorageKey('holdings'));
        const savedTrades = await AsyncStorage.getItem(getStorageKey('trades'));
        const savedCash = await AsyncStorage.getItem(getStorageKey('cash'));
        const savedBrokerId = await AsyncStorage.getItem(getStorageKey('brokerId'));
        const savedDividends = await AsyncStorage.getItem(getStorageKey('dividends'));

        let currentHoldings: HoldingItem[] = savedHoldings ? JSON.parse(savedHoldings) : [];
        let trades: RealizedTrade[] = savedTrades ? JSON.parse(savedTrades) : [];
        let cashNum = savedCash ? (parseFloat(savedCash) || 0) : 0;
        const parsedDividends: LedgerEntry[] = savedDividends ? JSON.parse(savedDividends) : [];

        // 立即顯示本地快取，確保介面流暢無延遲
        setHoldings(currentHoldings);
        setHistoryTrades(trades);
        rebuildLedgerEntries(trades, parsedDividends);
        setCash(cashNum);

        if (savedBrokerId) {
          setSelectedBrokerId(savedBrokerId);
        } else if (profile?.defaultBrokerId) {
          setSelectedBrokerId(profile.defaultBrokerId);
        }

        // 🌐 若已登入使用者，向 Supabase 進行雙向同步載入
        if (user?.id) {
          try {
            const [dbHoldings, dbTrades] = await Promise.all([
              fetchHoldingsFromSupabase(user.id),
              fetchTradesFromSupabase(user.id),
            ]);

            // 持股同步：雲端有資料則以雲端為主並更新快取；若雲端無資料但本地有，自動上傳至雲端
            if (dbHoldings && dbHoldings.length > 0) {
              currentHoldings = dbHoldings;
              setHoldings(dbHoldings);
              await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(dbHoldings));
            } else if (currentHoldings.length > 0) {
              await saveMultipleHoldingsToSupabase(user.id, currentHoldings);
            }

            // 交易歷史同步：雲端有資料則以雲端為主；若雲端無但本地有，自動同步上傳
            if (dbTrades && dbTrades.length > 0) {
              trades = dbTrades;
              setHistoryTrades(trades);
              rebuildLedgerEntries(trades, parsedDividends);
              await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(trades));
            } else if (trades.length > 0) {
              for (const t of trades) {
                await saveTradeToSupabase(user.id, t);
              }
            }
          } catch (syncErr) {
            console.warn('與 Supabase 雲端同步失敗，維持使用本地快取:', syncErr);
          }
        }

        const dueTrades = trades.filter(t => isTradeRebateDue(t));
        if (dueTrades.length > 0) {
          const autoRefundSum = dueTrades.reduce((sum, t) => sum + (t.rebateAmount || 0), 0);
          cashNum += autoRefundSum;
          const updatedTrades = trades.map(t => isTradeRebateDue(t) ? { ...t, isRebated: true } : t);
          
          setHistoryTrades(updatedTrades);
          rebuildLedgerEntries(updatedTrades, parsedDividends);
          setCash(cashNum);
          
          await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(updatedTrades));
          await AsyncStorage.setItem(getStorageKey('cash'), cashNum.toString());

          if (user?.id) {
            for (const dt of updatedTrades.filter(t => isTradeRebateDue(t))) {
              saveTradeToSupabase(user.id, dt).catch(() => {});
            }
          }

          setRebateSuccessMsg(`🟢 系統依賣出時間排程, 已自動將 ${dueTrades.length} 筆到期手續費折讓款共 NT$${autoRefundSum.toLocaleString()} 元退回並加到您的資產中！`);
          setTimeout(() => setRebateSuccessMsg(''), 6000);
        }
      } catch (err) {
        console.warn('載入本地快取資料失敗:', err);
      }
    };

    loadSavedData();
    safeGetUsdToTwdRate().then(rate => setUsdRate(rate));
  }, [user?.id]);

  useEffect(() => {
    if (profile?.defaultBrokerId) {
      setSelectedBrokerId(profile.defaultBrokerId);
    }
  }, [profile?.defaultBrokerId]);

  const handleSelectBroker = (brokerId: string) => {
    setSelectedBrokerId(brokerId);
    updateDefaultBroker(brokerId);
    AsyncStorage.setItem(getStorageKey('brokerId'), brokerId).catch(() => {});
  };

  const [inputYears, setInputYears] = useState(profile?.targetYears?.toString() || '3');
  const [inputProfit, setInputProfit] = useState(profile?.targetProfit?.toString() || '100000');

  useEffect(() => {
    if (profile) {
      setInputYears(profile.targetYears.toString());
      setInputProfit(profile.targetProfit.toString());
    }
  }, [profile]);

  const [selectedHolding, setSelectedHolding] = useState<HoldingItem | null>(null);
  const [formMarket, setFormMarket] = useState<'TW' | 'US'>('TW');
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formShares, setFormShares] = useState('');
  const [formAvgCost, setFormAvgCost] = useState('');
  const [formCurrentPrice, setFormCurrentPrice] = useState('');
  const [formBuyDate, setFormBuyDate] = useState(new Date().toISOString().split('T')[0]);
  const [formBuyHour, setFormBuyHour] = useState('');
  const [formBuyMinute, setFormBuyMinute] = useState('');
  const [formIsDCA, setFormIsDCA] = useState<boolean>(false);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [quoteStatusMsg, setQuoteStatusMsg] = useState<{ type: 'success' | 'error' | 'loading' | ''; text: string }>({ type: '', text: '' });
  const [formErrorMsg, setFormErrorMsg] = useState('');
  const [formWarningMsg, setFormWarningMsg] = useState('');

  const [sellPriceInput, setSellPriceInput] = useState('');
  const [sellSharesInput, setSellSharesInput] = useState('');
  const [sellDateInput, setSellDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [sellHour, setSellHour] = useState('');
  const [sellMinute, setSellMinute] = useState('');
  const [sellTradeMode, setSellTradeMode] = useState<'normal' | 'dayTrade' | 'dca'>('normal');
  const [sellErrorMsg, setSellErrorMsg] = useState('');
  const [sellWarningMsg, setSellWarningMsg] = useState('');

  const addHourOptions = useMemo(() => getTradingHourOptions(formMarket, formBuyDate), [formMarket, formBuyDate]);
  useEffect(() => {
    if (!addHourOptions.some(h => h.value === formBuyHour)) {
      setFormBuyHour(addHourOptions[0]?.value || '');
    }
  }, [addHourOptions]);

  const addMinuteOptions = useMemo(() => getTradingMinuteOptions(formMarket, formBuyDate, formBuyHour), [formMarket, formBuyDate, formBuyHour]);
  useEffect(() => {
    if (!addMinuteOptions.some(m => m.value === formBuyMinute)) {
      setFormBuyMinute(addMinuteOptions[0]?.value || '');
    }
  }, [addMinuteOptions]);

  const sellMarket = selectedHolding?.currency === 'USD' || selectedHolding?.market === 'US' ? 'US' : 'TW';
  const sellHourOptions = useMemo(() => getTradingHourOptions(sellMarket, sellDateInput), [sellMarket, sellDateInput]);
  useEffect(() => {
    if (!sellHourOptions.some(h => h.value === sellHour)) {
      setSellHour(sellHourOptions[0]?.value || '');
    }
  }, [sellHourOptions]);

  const sellMinuteOptions = useMemo(() => getTradingMinuteOptions(sellMarket, sellDateInput, sellHour), [sellMarket, sellDateInput, sellHour]);
  useEffect(() => {
    if (!sellMinuteOptions.some(m => m.value === sellMinute)) {
      setSellMinute(sellMinuteOptions[0]?.value || '');
    }
  }, [sellMinuteOptions]);

  useEffect(() => {
    if (formMarket === 'TW') {
      const timeCheck = validateTradingTime(formMarket, formBuyDate, formBuyHour, formBuyMinute);
      if (timeCheck.errorMsg && timeCheck.isValid) {
        setFormWarningMsg(timeCheck.errorMsg);
      } else {
        setFormWarningMsg('');
      }
    } else {
      setFormWarningMsg('');
    }
  }, [formMarket, formBuyDate, formBuyHour, formBuyMinute]);

  useEffect(() => {
    if (sellMarket === 'TW') {
      const timeCheck = validateTradingTime(sellMarket, sellDateInput, sellHour, sellMinute);
      if (timeCheck.errorMsg && timeCheck.isValid) {
        setSellWarningMsg(timeCheck.errorMsg);
      } else {
        setSellWarningMsg('');
      }
    } else {
      setSellWarningMsg('');
    }
  }, [sellMarket, sellDateInput, sellHour, sellMinute]);

  const cleanPositiveNumber = (text: string) => text.replace(/[^0-9.]/g, '');

  const formatWithCommas = (text: string) => {
    const cleaned = cleanPositiveNumber(text);
    if (!cleaned) return '';
    const parts = cleaned.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? `${integerPart}.${parts[1]}` : integerPart;
  };

  const parseNumber = (text: string) => parseFloat(text.replace(/,/g, '')) || 0;

  const totalStockValue = holdings.reduce((sum, item) => {
    const rate = item.currency === 'USD' ? usdRate : 1;
    return sum + item.shares * item.currentPrice * rate;
  }, 0);

  const totalNetWorth = cash + totalStockValue;

  const unrealizedPL = holdings.reduce((sum, item) => {
    return sum + calculateHoldingUnrealized(item, currentBroker, usdRate).netProfitTwd;
  }, 0);

  const realizedPL = historyTrades.reduce((sum, item) => {
    const rate = item.currency === 'USD' ? usdRate : 1;
    return sum + item.netProfit * rate;
  }, 0);

  const pendingRebatesList = historyTrades.filter(t => !t.isRebated && (t.rebateAmount || 0) > 0);
  const totalPendingRebates = pendingRebatesList.reduce((sum, t) => sum + (t.rebateAmount || 0), 0);

  const totalProfitSum = unrealizedPL + realizedPL;
  const targetProfitGoal = profile?.targetProfit || 100000;
  const milestoneProgress = Math.min(Math.max((totalProfitSum / targetProfitGoal) * 100, 0), 100);

  const stockSummaries: StockSummaryGroup[] = React.useMemo(() => {
    const map = new Map<string, StockSummaryGroup>();

    holdings.forEach((item) => {
      const codeKey = item.code.toUpperCase();
      const existing = map.get(codeKey);
      const calc = calculateHoldingUnrealized(item, currentBroker, usdRate);

      if (existing) {
        existing.buyCount += 1;
        existing.totalShares += item.shares;
        existing.totalCost += calc.totalCost;
        existing.totalVal += calc.totalVal;
        existing.unrealizedPl += calc.pl;
        existing.holdingsList.push(item);
      } else {
        map.set(codeKey, {
          code: codeKey,
          name: item.name,
          market: item.market || 'TW',
          currency: item.currency || 'TWD',
          buyCount: 1,
          totalShares: item.shares,
          totalCost: calc.totalCost,
          avgCost: item.avgCost,
          currentPrice: item.currentPrice,
          totalVal: calc.totalVal,
          unrealizedPl: calc.pl,
          roi: 0,
          holdingsList: [item],
        });
      }
    });

    const result: StockSummaryGroup[] = [];
    map.forEach((group) => {
      group.avgCost = group.totalShares > 0 ? Math.round((group.totalCost / group.totalShares) * 100) / 100 : 0;
      group.roi = group.totalCost > 0 ? (group.unrealizedPl / group.totalCost) * 100 : 0;
      result.push(group);
    });

    return result;
  }, [holdings, currentBroker, usdRate]);

  const historySummaries = React.useMemo(() => {
    const map = new Map<string, { code: string; name: string; currency: 'TWD' | 'USD'; sellCount: number; totalShares: number; totalNetProfit: number }>();

    historyTrades.forEach((t) => {
      const codeKey = t.code.toUpperCase();
      const existing = map.get(codeKey);
      const cur = t.currency || (t.market === 'US' ? 'USD' : 'TWD');

      if (existing) {
        existing.sellCount += 1;
        existing.totalShares += t.shares;
        existing.totalNetProfit += t.netProfit;
      } else {
        map.set(codeKey, {
          code: codeKey,
          name: t.name,
          currency: cur,
          sellCount: 1,
          totalShares: t.shares,
          totalNetProfit: t.netProfit,
        });
      }
    });

    const result: Array<{ code: string; name: string; currency: 'TWD' | 'USD'; sellCount: number; totalShares: number; totalNetProfit: number }> = [];
    map.forEach((val) => result.push(val));
    return result;
  }, [historyTrades]);

  const filteredHoldings = React.useMemo(() => {
    if (!selectedFilterCode) return holdings;
    return holdings.filter(h => h.code.toUpperCase() === selectedFilterCode.toUpperCase());
  }, [holdings, selectedFilterCode]);

  const filteredHistoryTrades = React.useMemo(() => {
    if (!selectedHistoryFilterCode) return historyTrades;
    return historyTrades.filter(t => t.code.toUpperCase() === selectedHistoryFilterCode.toUpperCase());
  }, [historyTrades, selectedHistoryFilterCode]);

  const handleSaveGoal = () => {
    const y = parseInt(parseNumber(inputYears).toString()) || 1;
    const p = parseNumber(inputProfit) || 10000;
    updateGoalMilestone(y, p);
    setSettingsModalVisible(false);
  };

  const handleClaimSingleRebate = async (tradeId: string) => {
    const trade = historyTrades.find(t => t.id === tradeId);
    if (!trade || trade.isRebated || !trade.rebateAmount) return;

    const refund = trade.rebateAmount;
    const newCash = cash + refund;
    const updatedTrades = historyTrades.map(t => t.id === tradeId ? { ...t, isRebated: true } : t);

    setCash(newCash);
    setHistoryTrades(updatedTrades);
    const existingDividends = ledgerEntries.filter(e => e.type === 'DIVIDEND');
    rebuildLedgerEntries(updatedTrades, existingDividends);

    await AsyncStorage.setItem(getStorageKey('cash'), newCash.toString());
    await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(updatedTrades));

    if (user?.id) {
      const updatedTrade = updatedTrades.find(t => t.id === tradeId);
      if (updatedTrade) {
        saveTradeToSupabase(user.id, updatedTrade).catch(e => console.warn('Supabase 更新折讓失敗:', e));
      }
    }
    
    setRebateSuccessMsg(`🟢 已將【${trade.name}】的手續費折讓款 NT$${refund.toLocaleString()} 元加到您的可用現金與資產！`);
    setTimeout(() => setRebateSuccessMsg(''), 4000);
  };

  const handleClaimAllRebates = async () => {
    if (totalPendingRebates <= 0) return;

    const newCash = cash + totalPendingRebates;
    const updatedTrades = historyTrades.map(t => (t.rebateAmount && !t.isRebated) ? { ...t, isRebated: true } : t);

    setCash(newCash);
    setHistoryTrades(updatedTrades);
    const existingDividends = ledgerEntries.filter(e => e.type === 'DIVIDEND');
    rebuildLedgerEntries(updatedTrades, existingDividends);

    await AsyncStorage.setItem(getStorageKey('cash'), newCash.toString());
    await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(updatedTrades));

    if (user?.id) {
      for (const t of updatedTrades.filter(tr => tr.rebateAmount && tr.isRebated)) {
        saveTradeToSupabase(user.id, t).catch(() => {});
      }
    }

    setRebateSuccessMsg(`🟢 已將所有手續費退佣共 NT$${totalPendingRebates.toLocaleString()} 元成功加到您的可用現金與資產中！`);
    setTimeout(() => setRebateSuccessMsg(''), 4000);
  };

  // 刪除歷史紀錄的防呆與處理函式
  const handleDeleteHistoryTrade = async (tradeId: string) => {
    const targetTrade = historyTrades.find(t => t.id === tradeId);
    if (!targetTrade) return;

    const confirmMsg = `⚠️ 【刪除歷史紀錄防呆警示】\n\n您確定要刪除這筆已實現歷史紀錄嗎？\n標的：${targetTrade.code} ${targetTrade.name}\n售出日期：${targetTrade.sellDate}\n淨利：${targetTrade.netProfit >= 0 ? '+' : ''}${targetTrade.netProfit.toLocaleString()}\n\n注意：刪除後將無法復原！`;

    let isConfirmed = false;
    if (Platform.OS === 'web' || typeof window !== 'undefined') {
      isConfirmed = window.confirm(confirmMsg);
    } else {
      isConfirmed = true;
    }

    if (!isConfirmed) return;

    const updatedTrades = historyTrades.filter(t => t.id !== tradeId);
    setHistoryTrades(updatedTrades);
    const existingDividends = ledgerEntries.filter(e => e.type === 'DIVIDEND');
    rebuildLedgerEntries(updatedTrades, existingDividends);

    try {
      await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(updatedTrades));
      if (user?.id) {
        deleteTradeFromSupabase(tradeId).catch(e => console.warn('Supabase 刪除歷史紀錄失敗:', e));
      }
      setRebateSuccessMsg(`🗑️ 已成功刪除歷史紀錄：${targetTrade.code} ${targetTrade.name}`);
      setTimeout(() => setRebateSuccessMsg(''), 4000);
    } catch (e) {
      console.warn('刪除歷史紀錄寫入儲存失敗', e);
    }
  };

  // 領股息觸發與確認處理函式 (自動取買進日作為最小日期限制)
  const handleOpenDividend = (item: HoldingItem) => {
    setSelectedHolding(item);
    setDividendPerShareInput('');
    setDividendErrorMsg('');
    const baseBuyDate = (item.buyDate || todayTaiwanStr).split(' ')[0];
    setDividendDateInput(baseBuyDate >= todayTaiwanStr ? baseBuyDate : todayTaiwanStr);
    setDividendModalVisible(true);
  };

  const handleConfirmDividend = async () => {
    if (!selectedHolding) return;
    const dps = parseNumber(dividendPerShareInput);
    if (dps <= 0 || isNaN(dps)) {
      setDividendErrorMsg('❌ 請輸入大於 0 的每股配息金額！');
      return;
    }

    const baseBuyDate = (selectedHolding.buyDate || '2000-01-01').split(' ')[0];
    if (dividendDateInput < baseBuyDate) {
      setDividendErrorMsg(`❌ 股息發放日期 (${dividendDateInput}) 不得早於股票買入日期 (${baseBuyDate})！`);
      return;
    }

    const totalDividend = Math.round(selectedHolding.shares * dps);
    const newCash = cash + totalDividend;
    setCash(newCash);

    const newLedgerEntry: LedgerEntry = {
      id: `${Date.now()}_div`,
      tradeId: selectedHolding.id,
      date: dividendDateInput,
      type: 'DIVIDEND',
      typeName: '現金股利收入',
      code: selectedHolding.code,
      name: selectedHolding.name,
      amount: totalDividend,
      note: `持有 ${selectedHolding.shares.toLocaleString()} 股，每股配息 $${dps}`
    };

    const updatedDividends = [newLedgerEntry, ...ledgerEntries.filter(e => e.type === 'DIVIDEND')];
    rebuildLedgerEntries(historyTrades, updatedDividends);

    try {
      await AsyncStorage.setItem(getStorageKey('cash'), newCash.toString());
      await AsyncStorage.setItem(getStorageKey('dividends'), JSON.stringify(updatedDividends));
    } catch (e) {
      console.warn('儲存現金或股利失敗', e);
    }

    setRebateSuccessMsg(`💰 已成功將【${selectedHolding.name}】現金股利 NT$${totalDividend.toLocaleString()} 元加入可用現金與總資產！`);
    setTimeout(() => setRebateSuccessMsg(''), 4000);
    setDividendModalVisible(false);
  };

  const handleTriggerFetchQuote = async (targetCode?: string) => {
    const codeToQuery = (targetCode ?? formCode).trim();
    if (!codeToQuery) return;

    setIsFetchingQuote(true);
    setQuoteStatusMsg({ type: 'loading', text: `⏳ 正在即時抓取【${codeToQuery}】最新市價與資訊...` });

    try {
      const quote = await safeFetchStockQuote(codeToQuery);
      if (quote && quote.currentPrice > 0) {
        setFormMarket(quote.market);
        setFormCurrentPrice(formatWithCommas(quote.currentPrice.toString()));
        if (!formName || formName === formCode || formName === quote.code) {
          setFormName(quote.name);
        }
        setQuoteStatusMsg({
          type: 'success',
          text: `🟢 已即時抓取市價: ${quote.currency === 'USD' ? '$' : 'NT$'}${quote.currentPrice.toLocaleString()} (${quote.name})`
        });
      } else {
        setQuoteStatusMsg({
          type: 'error',
          text: `⚠️ 系統未能自動取得最新報價，您仍可自行手動輸入即時單價與名稱。`
        });
      }
    } catch (err) {
      setQuoteStatusMsg({
        type: 'error',
        text: `⚠️ 報價伺服器連線繁忙，您可直接手動輸入單價。`
      });
    } finally {
      setIsFetchingQuote(false);
    }
  };

  const handleCodeChange = (text: string) => {
    setFormCode(text);
    if (!text.trim()) {
      setQuoteStatusMsg({ type: '', text: '' });
      return;
    }

    const { market, cleanCode } = detectStockMarket(text);
    setFormMarket(market);

    const popular = POPULAR_STOCKS[cleanCode];
    if (popular && !formName) {
      setFormName(popular.name);
    }
  };

  const handleRefreshAllPrices = async () => {
    if (holdings.length === 0) return;
    setIsRefreshingAll(true);
    try {
      const codes = holdings.map(h => h.code);
      const quotes = await safeFetchMultipleStockQuotes(codes);
      const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
      
      const updatedHoldings = holdings.map(item => {
        const quote = quotes[item.code.toUpperCase()] || quotes[item.code];
        if (quote && quote.currentPrice > 0) {
          return {
            ...item,
            currentPrice: quote.currentPrice,
            lastUpdated: nowStr,
          };
        }
        return item;
      });

      setHoldings(updatedHoldings);
      await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(updatedHoldings));

      if (user?.id && updatedHoldings.length > 0) {
        saveMultipleHoldingsToSupabase(user.id, updatedHoldings).catch(e => console.warn('Supabase 批量更新持股失敗:', e));
      }

      const rate = await safeGetUsdToTwdRate();
      setUsdRate(rate);
      setLastRefreshedTime(nowStr);
    } catch (e) {
      console.warn('更新全部股價失敗', e);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleAddHolding = async () => {
    setFormErrorMsg('');

    const timeCheck = validateTradingTime(formMarket, formBuyDate, formBuyHour, formBuyMinute);
    if (!timeCheck.isValid) {
      setFormErrorMsg(timeCheck.errorMsg);
      return;
    }

    const sharesNum = parseInt(parseNumber(formShares).toString()) || 0;
    const costNum = parseNumber(formAvgCost) || 0;
    const currentPriceNum = parseNumber(formCurrentPrice) || costNum;

    if (!formCode.trim()) {
      setFormErrorMsg('❌ 請輸入股票代號！');
      return;
    }
    if (sharesNum <= 0 || isNaN(sharesNum)) {
      setFormErrorMsg('❌ 買入股數必須為大於 0 的正整數！');
      return;
    }
    if (costNum <= 0 || isNaN(costNum)) {
      setFormErrorMsg('❌ 成本單價必須為大於 0 的正數！');
      return;
    }

    const finalName = formName.trim() || formCode.trim();
    const finalTimeStr = (formBuyHour && formBuyMinute) ? `${formBuyHour}:${formBuyMinute}` : '';

    const newHolding: HoldingItem = {
      id: Date.now().toString(),
      code: formCode.trim().toUpperCase(),
      name: finalName,
      shares: sharesNum,
      avgCost: costNum,
      currentPrice: currentPriceNum,
      buyDate: finalTimeStr ? `${formBuyDate} ${finalTimeStr}` : formBuyDate,
      market: formMarket,
      currency: (formMarket === 'US' ? 'USD' : 'TWD') as 'USD' | 'TWD',
      isDCA: formIsDCA,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    };

    const updatedHoldings = [...holdings, newHolding];
    setHoldings(updatedHoldings);
    await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(updatedHoldings));

    if (user?.id) {
      saveHoldingToSupabase(user.id, newHolding).catch(e => console.warn('Supabase 持股儲存失敗:', e));
    }

    resetForm();
    setAddModalVisible(false);
  };

  const handleOpenEdit = (item: HoldingItem) => {
    setSelectedHolding(item);
    setFormCode(item.code);
    setFormName(item.name);
    const itemMarket = item.market || detectStockMarket(item.code).market;
    setFormMarket(itemMarket);
    setFormShares(formatWithCommas(item.shares.toString()));
    setFormAvgCost(formatWithCommas(item.avgCost.toString()));
    setFormCurrentPrice(formatWithCommas(item.currentPrice.toString()));
    setFormIsDCA(!!item.isDCA);
    
    if (item.buyDate && item.buyDate.includes(' ')) {
      const parts = item.buyDate.split(' ');
      setFormBuyDate(parts[0]);
      const timeParts = (parts[1] || '').split(':');
      setFormBuyHour(timeParts[0] || '');
      setFormBuyMinute(timeParts[1] || '');
    } else {
      setFormBuyDate(item.buyDate || new Date().toISOString().split('T')[0]);
      setFormBuyHour('');
      setFormBuyMinute('');
    }

    setQuoteStatusMsg({ type: '', text: '' });
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedHolding) return;

    const timeCheck = validateTradingTime(formMarket, formBuyDate, formBuyHour, formBuyMinute);
    if (!timeCheck.isValid) {
      setFormErrorMsg(timeCheck.errorMsg);
      return;
    }

    const finalTimeStr = (formBuyHour && formBuyMinute) ? `${formBuyHour}:${formBuyMinute}` : '';

    const sharesNum = parseInt(parseNumber(formShares).toString()) || 0;
    const costNum = parseNumber(formAvgCost) || 0;
    const priceNum = parseNumber(formCurrentPrice) || 0;

    const updatedHoldings = holdings.map(h => h.id === selectedHolding.id ? {
      ...h,
      name: formName.trim() || h.name,
      shares: sharesNum,
      avgCost: costNum,
      currentPrice: priceNum,
      buyDate: finalTimeStr ? `${formBuyDate} ${finalTimeStr}` : formBuyDate,
      market: formMarket,
      currency: (formMarket === 'US' ? 'USD' : 'TWD') as 'USD' | 'TWD',
      isDCA: formIsDCA,
      lastUpdated: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    } : h);

    setHoldings(updatedHoldings);
    await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(updatedHoldings));

    const editedHolding = updatedHoldings.find(h => h.id === selectedHolding.id);
    if (user?.id && editedHolding) {
      saveHoldingToSupabase(user.id, editedHolding).catch(e => console.warn('Supabase 持股更新失敗:', e));
    }

    resetForm();
    setEditModalVisible(false);
  };

  const handleDeleteHolding = async (id: string) => {
    const updatedHoldings = holdings.filter(h => h.id !== id);
    setHoldings(updatedHoldings);
    await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(updatedHoldings));

    if (user?.id) {
      deleteHoldingFromSupabase(id).catch(e => console.warn('Supabase 持股刪除失敗:', e));
    }

    setEditModalVisible(false);
  };

  const handleOpenSell = (item: HoldingItem) => {
    setSelectedHolding(item);
    setSellPriceInput(formatWithCommas(item.currentPrice.toString()));
    setSellSharesInput(formatWithCommas(item.shares.toString()));
    const dateToday = getTodayTaiwanStr();
    setSellDateInput(dateToday);
    setSellHour('');
    setSellMinute('');
    setSellTradeMode(item.isDCA ? 'dca' : 'normal');
    setSellErrorMsg('');
    setSellModalVisible(true);
  };

  const handleConfirmSell = async () => {
    if (!selectedHolding) return;
    setSellErrorMsg('');

    const sellMarketCheck = selectedHolding.currency === 'USD' || selectedHolding.market === 'US' ? 'US' : 'TW';
    const timeCheck = validateTradingTime(sellMarketCheck, sellDateInput, sellHour, sellMinute);
    if (!timeCheck.isValid) {
      setSellErrorMsg(timeCheck.errorMsg);
      return;
    }

    const sPrice = parseNumber(sellPriceInput);
    const sShares = parseInt(parseNumber(sellSharesInput).toString()) || 0;

    if (sShares <= 0 || isNaN(sShares)) {
      setSellErrorMsg('❌ 賣出股數必須為大於 0 的正整數！');
      return;
    }
    if (sPrice <= 0 || isNaN(sPrice)) {
      setSellErrorMsg('❌ 賣出價格必須為大於 0 的有效數字！');
      return;
    }
    if (sShares > selectedHolding.shares) {
      setSellErrorMsg(`❌ 賣出股數 (${sShares.toLocaleString()}股) 不能大於實際持有股數 (${selectedHolding.shares.toLocaleString()}股)！`);
      return;
    }

    const isUS = selectedHolding.currency === 'USD' || selectedHolding.market === 'US';
    const finalSellTimeStr = (sellHour && sellMinute) ? `${sellHour}:${sellMinute}` : '';
    const bPrice = selectedHolding.avgCost;
    const grossRevenue = sPrice * sShares;
    const isETF = isETFCode(selectedHolding.code);
    const isSellDayTrade = sellTradeMode === 'dayTrade';
    const isSellDCA = sellTradeMode === 'dca';
    
    let netProfit = 0;
    let tax = 0;
    let taxRate = 0;
    let originalSellFee = 0;
    let discountedSellFee = 0;
    let rebateAmount = 0;
    let cashToAddNow = 0;
    let isRebated = false;

    if (isUS) {
      const cost = bPrice * sShares;
      netProfit = Math.round((grossRevenue - cost) * 100) / 100;
      cashToAddNow = grossRevenue * usdRate;
      isRebated = true;
    } else {
      const buyAmount = bPrice * sShares;
      const { discountedFee: buyFee } = calculateBuyFee({
        amount: buyAmount,
        shares: sShares,
        broker: currentBroker,
        isDCA: isSellDCA,
        market: 'TW',
      });
      const cost = buyAmount + buyFee;

      const sellFeeRes = calculateSellFeeAndTax({
        code: selectedHolding.code,
        amount: grossRevenue,
        shares: sShares,
        broker: currentBroker,
        isDayTrade: isSellDayTrade,
        market: 'TW',
      });

      tax = sellFeeRes.tax;
      taxRate = sellFeeRes.taxRate;
      originalSellFee = sellFeeRes.originalFee;
      discountedSellFee = sellFeeRes.discountedFee;
      rebateAmount = sellFeeRes.rebateAmount;

      const finalRevenue = grossRevenue - discountedSellFee - tax;
      netProfit = Math.round(finalRevenue - cost);

      if (currentBroker.rebateType === 'instant') {
        cashToAddNow = grossRevenue - discountedSellFee - tax;
        rebateAmount = 0;
        isRebated = true;
      } else {
        cashToAddNow = grossRevenue - originalSellFee - tax;
        isRebated = false;
      }
    }

    const newTrade: RealizedTrade = {
      id: Date.now().toString(),
      code: selectedHolding.code,
      name: selectedHolding.name,
      buyDate: selectedHolding.buyDate,
      sellDate: finalSellTimeStr ? `${sellDateInput} ${finalSellTimeStr}` : sellDateInput,
      shares: sShares,
      buyPrice: bPrice,
      sellPrice: sPrice,
      isDayTrade: isSellDayTrade,
      netProfit: netProfit,
      market: selectedHolding.market,
      currency: selectedHolding.currency,
      isDCA: isSellDCA,
      isETF: isETF,
      taxRate: taxRate,
      brokerId: currentBroker.id,
      brokerName: currentBroker.name,
      grossRevenue: grossRevenue,
      tax: tax,
      originalSellFee: originalSellFee,
      discountedSellFee: discountedSellFee,
      rebateAmount: rebateAmount,
      rebateType: currentBroker.rebateType,
      rebateDesc: currentBroker.rebateDayDesc,
      isRebated: isRebated,
    };

    const updatedTrades = [newTrade, ...historyTrades];
    setHistoryTrades(updatedTrades);
    const existingDividends = ledgerEntries.filter(e => e.type === 'DIVIDEND');
    rebuildLedgerEntries(updatedTrades, existingDividends);
    
    let updatedHoldings: HoldingItem[] = [];
    if (sShares === selectedHolding.shares) {
      updatedHoldings = holdings.filter(h => h.id !== selectedHolding.id);
      if (user?.id) {
        deleteHoldingFromSupabase(selectedHolding.id).catch(e => console.warn('Supabase 刪除持股失敗:', e));
      }
    } else {
      updatedHoldings = holdings.map(h => h.id === selectedHolding.id ? {
        ...h,
        shares: h.shares - sShares
      } : h);
      const remainingHolding = updatedHoldings.find(h => h.id === selectedHolding.id);
      if (user?.id && remainingHolding) {
        saveHoldingToSupabase(user.id, remainingHolding).catch(e => console.warn('Supabase 更新持股失敗:', e));
      }
    }
    setHoldings(updatedHoldings);

    const updatedCash = cash + Math.round(cashToAddNow);
    setCash(updatedCash);

    try {
      await AsyncStorage.setItem(getStorageKey('trades'), JSON.stringify(updatedTrades));
      await AsyncStorage.setItem(getStorageKey('holdings'), JSON.stringify(updatedHoldings));
      await AsyncStorage.setItem(getStorageKey('cash'), updatedCash.toString());
      if (user?.id) {
        saveTradeToSupabase(user.id, newTrade).catch(e => console.warn('Supabase 儲存歷史紀錄失敗:', e));
      }
    } catch (e) {
      console.warn('寫入 AsyncStorage 失敗:', e);
    }

    setSellModalVisible(false);
  };

  const handleDownloadCSV = () => {
    if (filteredLedgerEntries.length === 0) return;

    const headers = ['日期時間', '交易類別', '股票代號', '股票名稱', '異動金額(NT$)', '備註說明'];
    const rows = filteredLedgerEntries.map(e => [
      `"${e.date}"`,
      `"${e.typeName}"`,
      `"${e.code}"`,
      `"${e.name}"`,
      e.amount,
      `"${e.note}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });

    if (Platform.OS === 'web' || typeof window !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `mystock_history_${ledgerTimeRange}_${getTodayTaiwanStr()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert('請在 Web 版瀏覽器中直接點擊下載 CSV 檔案。');
    }
  };

  const resetForm = () => {
    setFormCode('');
    setFormName('');
    setFormShares('');
    setFormAvgCost('');
    setFormCurrentPrice('');
    const dateToday = getTodayTaiwanStr();
    setFormBuyDate(dateToday);
    setFormBuyHour('');
    setFormBuyMinute('');
    setFormIsDCA(false);
    setQuoteStatusMsg({ type: '', text: '' });
    setFormErrorMsg('');
    setFormWarningMsg('');
    setSelectedHolding(null);
  };

  const previewShares = parseInt(parseNumber(formShares).toString()) || 0;
  const previewCostUnit = parseNumber(formAvgCost) || 0;
  const previewCurrentUnit = parseNumber(formCurrentPrice) || 0;
  const tempHolding: HoldingItem = {
    id: 'preview',
    code: formCode || 'PREVIEW',
    name: formName || 'PREVIEW',
    shares: previewShares,
    avgCost: previewCostUnit,
    currentPrice: previewCurrentUnit,
    market: formMarket,
    currency: formMarket === 'US' ? 'USD' : 'TWD',
    isDCA: formIsDCA,
  };
  const previewCalc = calculateHoldingUnrealized(tempHolding, currentBroker, usdRate);
  const currSymbol = formMarket === 'US' ? '$' : 'NT$';

  const sPrice = parseNumber(sellPriceInput);
  const sShares = parseInt(parseNumber(sellSharesInput).toString()) || 0;
  const sellIsUS = selectedHolding?.currency === 'USD' || selectedHolding?.market === 'US';
  const sellCurrSym = sellIsUS ? '$' : 'NT$';

  const isSharesOverLimit = selectedHolding ? sShares > selectedHolding.shares : false;

  let sellModalGross = sPrice * sShares;
  let sellModalTax = 0;
  let sellModalTaxRate = 0;
  let sellModalOriginalFee = 0;
  let sellModalDiscountedFee = 0;
  let sellModalRebate = 0;
  let sellModalInitialCash = 0;
  let sellModalFinalRevenue = 0;
  let sellModalNetProfit = 0;
  let sellModalRoi = 0;
  let sellModalBuyFee = 0;
  const sellIsETF = selectedHolding ? isETFCode(selectedHolding.code) : false;

  if (selectedHolding && sPrice > 0 && sShares > 0 && !isSharesOverLimit) {
    const bPrice = selectedHolding.avgCost;
    if (sellIsUS) {
      sellModalGross = sPrice * sShares;
      sellModalTax = 0;
      sellModalTaxRate = 0;
      const cost = bPrice * sShares;
      sellModalInitialCash = sellModalGross;
      sellModalFinalRevenue = sellModalGross;
      sellModalNetProfit = Math.round((sellModalGross - cost) * 100) / 100;
      sellModalRoi = cost > 0 ? (sellModalNetProfit / cost) * 100 : 0;
    } else {
      sellModalGross = sPrice * sShares;
      const isSellDayTrade = sellTradeMode === 'dayTrade';
      const isSellDCA = sellTradeMode === 'dca';

      const feeRes = calculateSellFeeAndTax({
        code: selectedHolding.code,
        amount: sellModalGross,
        shares: sShares,
        broker: currentBroker,
        isDayTrade: isSellDayTrade,
        market: 'TW',
      });
      sellModalTax = feeRes.tax;
      sellModalTaxRate = feeRes.taxRate;
      sellModalOriginalFee = feeRes.originalFee;
      sellModalDiscountedFee = feeRes.discountedFee;
      sellModalRebate = feeRes.rebateAmount;

      const buyRes = calculateBuyFee({
        amount: bPrice * sShares,
        shares: sShares,
        broker: currentBroker,
        isDCA: isSellDCA,
        market: 'TW',
      });
      sellModalBuyFee = buyRes.discountedFee;
      const cost = bPrice * sShares + sellModalBuyFee;

      if (currentBroker.rebateType === 'instant') {
        sellModalRebate = 0;
        sellModalInitialCash = sellModalGross - sellModalDiscountedFee - sellModalTax;
        sellModalFinalRevenue = sellModalInitialCash;
      } else {
        sellModalInitialCash = sellModalGross - sellModalOriginalFee - sellModalTax;
        sellModalFinalRevenue = sellModalGross - sellModalDiscountedFee - sellModalTax;
      }

      sellModalNetProfit = Math.round(sellModalFinalRevenue - cost);
      sellModalRoi = cost > 0 ? (sellModalNetProfit / cost) * 100 : 0;
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentWrapper}>
      {rebateSuccessMsg ? (
        <View style={styles.rebateToast}>
          <Text style={styles.rebateToastText}>{rebateSuccessMsg}</Text>
        </View>
      ) : null}

      <View style={styles.highlightCard}>
        <View style={styles.headerRow}>
          <Text style={styles.highlightCardTitle}>🏆 【獲利目標里程碑】</Text>
          <TouchableOpacity onPress={() => setSettingsModalVisible(true)}>
            <Text style={styles.clickEditBtn}>⚙️ 點擊頭像/設定可更換證券戶</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.goalDisplayRow}>
          <View style={styles.goalDisplayBlock}>
            <Text style={styles.goalDisplayLabel}>目標年限</Text>
            <Text style={styles.goalDisplayValue}>{profile?.targetYears || 3} 年內</Text>
          </View>
          <View style={styles.goalDisplayBlock}>
            <Text style={styles.goalDisplayLabel}>目標賺取金額</Text>
            <Text style={styles.goalDisplayValue}>${(profile?.targetProfit || 100000).toLocaleString()} 元</Text>
          </View>
          <View style={styles.goalDisplayBlock}>
            <Text style={styles.goalDisplayLabel}>目前達成率</Text>
            <Text style={styles.goalDisplayValueHighlight}>{milestoneProgress.toFixed(1)}%</Text>
          </View>
        </View>

        <View style={styles.progressHeaderRow}>
          <Text style={styles.progressLabel}>累計淨利: ${Math.round(totalProfitSum).toLocaleString()} 元</Text>
          <Text style={styles.progressLabel}>目標額: ${(profile?.targetProfit || 100000).toLocaleString()} 元</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${milestoneProgress}%` }]} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>【資產總覽】 (折算新台幣)</Text>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity style={styles.ledgerTopLinkBtn} onPress={() => setLedgerFullScreenVisible(true)}>
              <Text style={styles.ledgerTopLinkBtnText}>📊 拆筆流水帳 ({ledgerEntries.length})</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.infoBtn} onPress={() => setInfoModalVisible(true)}>
              <Text style={styles.infoBtnText}>[?] 扣款與退佣說明</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.totalNetWorth}>${Math.round(totalNetWorth).toLocaleString()} 新台幣</Text>

        <View style={styles.wrapRow}>
          <Text style={styles.subText}>可用現金: ${cash.toLocaleString()}</Text>
          <Text style={styles.subText}>股票市值: ${Math.round(totalStockValue).toLocaleString()}</Text>
          <Text style={styles.subText}>即時匯率: 1 USD ≈ {usdRate.toFixed(2)} TWD</Text>
        </View>

        <TouchableOpacity 
          style={styles.activeBrokerTag} 
          onPress={() => setSettingsModalVisible(true)}
        >
          <Text style={styles.activeBrokerTagText}>
            🏛️ 目前證券戶：{currentBroker.name} ({(currentBroker.discount * 10).toFixed(1)}折 / 整股低消{currentBroker.minFee}元 · 零股低消{currentBroker.oddLotMinFee}元 · 定期定額{currentBroker.dcaMinFee}元) · 【{currentBroker.rebateType === 'instant' ? '現折' : currentBroker.rebateType === 'daily' ? '日退' : '月退'}】
          </Text>
          <Text style={styles.activeBrokerEditLink}>[切換券商]</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.wrapRow}>
          <View style={styles.plBlock}>
            <Text style={styles.subTitle}>未實現預估淨損益 (扣除實際規費與稅)</Text>
            <Text style={[styles.plText, unrealizedPL >= 0 ? styles.profit : styles.loss]}>
              {unrealizedPL >= 0 ? '獲利 +' : '虧損 -'}${Math.abs(Math.round(unrealizedPL)).toLocaleString()}
            </Text>
          </View>
          
          <View style={styles.plBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.subTitle}>歷史已實現損益</Text>
              <TouchableOpacity 
                style={styles.recordExplainBtn} 
                onPress={() => setRecordExplainModalVisible(true)}
              >
                <Text style={styles.recordExplainBtnText}>[?] 說明</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.plText, realizedPL >= 0 ? styles.profit : styles.loss]}>
              {realizedPL >= 0 ? '獲利 +' : '虧損 -'}${Math.abs(Math.round(realizedPL)).toLocaleString()}
            </Text>
          </View>
        </View>
      </View>

      {totalPendingRebates > 0 && (
        <View style={styles.pendingRebateBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingRebateTitle}>
              💰 待退手續費折讓金：+NT${totalPendingRebates.toLocaleString()} 元 ({pendingRebatesList.length} 筆)
            </Text>
            <Text style={styles.pendingRebateSubText}>
              依【{currentBroker.shortName}】退款排程（{currentBroker.rebateDayDesc}），點擊右方可直接撥款入帳加到您的資產。
            </Text>
          </View>
          <TouchableOpacity style={styles.claimAllBtn} onPress={handleClaimAllRebates}>
            <Text style={styles.claimAllBtnText}>撥款加回資產 ➔</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.actionRow}>
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tabBtn, tab === 'holdings' && styles.activeTab]} 
            onPress={() => setTab('holdings')}
          >
            <Text style={[styles.tabText, tab === 'holdings' && styles.activeTabText]}>現有持股 ({holdings.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tabBtn, tab === 'history' && styles.activeTab]} 
            onPress={() => setTab('history')}
          >
            <Text style={[styles.tabText, tab === 'history' && styles.activeTabText]}>
              歷史紀錄 ({historyTrades.length})
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'holdings' && (
          <View style={styles.btnGroup}>
            <TouchableOpacity 
              style={[styles.refreshBtn, isRefreshingAll && { opacity: 0.6 }]} 
              onPress={handleRefreshAllPrices}
              disabled={isRefreshingAll}
            >
              {isRefreshingAll ? (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
              ) : (
                <Text style={styles.refreshBtnText}>⚡ 一鍵更新現價</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.addBtn} onPress={() => { resetForm(); setAddModalVisible(true); }}>
              <Text style={styles.addBtnText}>+ 新增持股部位</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {lastRefreshedTime && tab === 'holdings' ? (
        <View style={styles.timestampBanner}>
          <Text style={styles.timestampText}>
            🟢 已完成全體股價即時更新 ({lastRefreshedTime}) | 套用券商: {currentBroker.name} ({currentBroker.rebateDayDesc})
          </Text>
        </View>
      ) : null}

      {tab === 'holdings' && stockSummaries.length > 0 && (
        <View style={styles.stockSummaryContainer}>
          <Text style={styles.stockSummaryHeader}>📊 我的持股快速點選與匯總（點擊標籤可過濾明細）：</Text>
          <View style={styles.stockChipsWrap}>
            <TouchableOpacity 
              style={[styles.stockChip, selectedFilterCode === null && styles.stockChipActive]}
              onPress={() => setSelectedFilterCode(null)}
            >
              <Text style={[styles.stockChipText, selectedFilterCode === null && styles.stockChipTextActive]}>
                全部持股 ({holdings.length}筆部位)
              </Text>
            </TouchableOpacity>

            {stockSummaries.map((s) => {
              const isSelected = selectedFilterCode === s.code;
              const sym = s.currency === 'USD' ? '$' : 'NT$';
              return (
                <TouchableOpacity 
                  key={s.code}
                  style={[styles.stockChip, isSelected && styles.stockChipActive]}
                  onPress={() => setSelectedFilterCode(isSelected ? null : s.code)}
                >
                  <Text style={[styles.stockChipText, isSelected && styles.stockChipTextActive]}>
                    {s.code} {s.name} ({s.buyCount}次，共{s.totalShares.toLocaleString()}股 | 均價{sym}{s.avgCost.toLocaleString()})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedFilterCode && (
            <View style={styles.filterDetailCard}>
              {(() => {
                const summary = stockSummaries.find(s => s.code === selectedFilterCode);
                if (!summary) return null;
                const sym = summary.currency === 'USD' ? '$' : 'NT$';
                return (
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.filterDetailTitle}>
                        📌 【{summary.code} {summary.name}】綜合統計彙整
                      </Text>
                      <TouchableOpacity onPress={() => setSelectedFilterCode(null)}>
                        <Text style={styles.closeFilterBtnText}>[清除過濾 ✕]</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.filterGrid}>
                      <Text style={styles.filterGridItem}>• 累計買入次數: {summary.buyCount} 次</Text>
                      <Text style={styles.filterGridItem}>• 總持有股數: {summary.totalShares.toLocaleString()} 股</Text>
                      <Text style={styles.filterGridItem}>• 綜合買入均價: {sym}{summary.avgCost.toLocaleString()}</Text>
                      <Text style={styles.filterGridItem}>• 當前最新現價: {sym}{summary.currentPrice.toLocaleString()}</Text>
                      <Text style={styles.filterGridItem}>• 總投入成本: {sym}{Math.round(summary.totalCost).toLocaleString()}</Text>
                      <Text style={styles.filterGridItem}>• 總當前市值: {sym}{Math.round(summary.totalVal).toLocaleString()}</Text>
                    </View>
                    <Text style={[styles.filterPlText, summary.unrealizedPl >= 0 ? styles.profit : styles.loss]}>
                      未實現預估損益: {summary.unrealizedPl >= 0 ? '獲利 +' : '虧損 -'}{sym}{Math.abs(Math.round(summary.unrealizedPl)).toLocaleString()} ({summary.roi.toFixed(2)}%)
                    </Text>
                  </View>
                );
              })()}
            </View>
          )}
        </View>
      )}

      {tab === 'history' && historySummaries.length > 0 && (
        <View style={styles.stockSummaryContainer}>
          <Text style={styles.stockSummaryHeader}>📊 歷史已實現紀錄快速點選與匯總（點擊標籤可過濾明細）：</Text>
          <View style={styles.stockChipsWrap}>
            <TouchableOpacity 
              style={[styles.stockChip, selectedHistoryFilterCode === null && styles.stockChipActive]}
              onPress={() => setSelectedHistoryFilterCode(null)}
            >
              <Text style={[styles.stockChipText, selectedHistoryFilterCode === null && styles.stockChipTextActive]}>
                全部歷史紀錄 ({historyTrades.length}筆)
              </Text>
            </TouchableOpacity>

            {historySummaries.map((hs) => {
              const isSelected = selectedHistoryFilterCode === hs.code;
              const sym = hs.currency === 'USD' ? '$' : 'NT$';
              return (
                <TouchableOpacity 
                  key={hs.code}
                  style={[styles.stockChip, isSelected && styles.stockChipActive]}
                  onPress={() => setSelectedHistoryFilterCode(isSelected ? null : hs.code)}
                >
                  <Text style={[styles.stockChipText, isSelected && styles.stockChipTextActive]}>
                    {hs.code} {hs.name} ({hs.sellCount}次售出 | 淨利{sym}{hs.totalNetProfit >= 0 ? '+' : ''}{hs.totalNetProfit.toLocaleString()})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedHistoryFilterCode && (
            <View style={styles.filterDetailCard}>
              {(() => {
                const summary = historySummaries.find(hs => hs.code === selectedHistoryFilterCode);
                if (!summary) return null;
                const sym = summary.currency === 'USD' ? '$' : 'NT$';
                return (
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.filterDetailTitle}>
                        📌 【{summary.code} {summary.name}】歷史已實現績效統計
                      </Text>
                      <TouchableOpacity onPress={() => setSelectedHistoryFilterCode(null)}>
                        <Text style={styles.closeFilterBtnText}>[清除過濾 ✕]</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.filterGrid}>
                      <Text style={styles.filterGridItem}>• 累計售出次數: {summary.sellCount} 次</Text>
                      <Text style={styles.filterGridItem}>• 累計售出總股數: {summary.totalShares.toLocaleString()} 股</Text>
                    </View>
                    <Text style={[styles.filterPlText, summary.totalNetProfit >= 0 ? styles.profit : styles.loss]}>
                      歷史已實現總淨損益: {summary.totalNetProfit >= 0 ? '獲利 +' : '虧損 -'}{sym}{Math.abs(summary.totalNetProfit).toLocaleString()}
                    </Text>
                  </View>
                );
              })()}
            </View>
          )}
        </View>
      )}

      {tab === 'holdings' ? (
        filteredHoldings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>【尚無符合條件之持股部位資料】</Text>
          </View>
        ) : (
          filteredHoldings.map((item) => {
            const isUS = item.currency === 'USD' || item.market === 'US';
            const sym = isUS ? '$' : 'NT$';
            const { pl, roi, totalVal, totalCost, buyFee, sellFee, tax, isETF } = calculateHoldingUnrealized(item, currentBroker, usdRate);

            return (
              <View key={item.id} style={styles.listItem}>
                <View style={{ flex: 1 }}>
                  <View style={styles.codeRow}>
                    <Text style={styles.stockCode}>{item.code} // {item.name}</Text>
                    <View style={[styles.marketBadge, isUS ? styles.badgeUS : styles.badgeTW]}>
                      <Text style={styles.marketBadgeText}>{isUS ? '美股' : '台股'}</Text>
                    </View>
                    {item.isDCA && (
                      <View style={styles.badgeDCA}>
                        <Text style={styles.badgeDCAText}>定期定額 1元手續費</Text>
                      </View>
                    )}
                    {isETF && (
                      <View style={styles.badgeETF}>
                        <Text style={styles.badgeETFText}>ETF 0.1%稅</Text>
                      </View>
                    )}
                  </View>

                  {item.buyDate && (
                    <Text style={styles.buyDateText}>📅 購入時間: {item.buyDate}</Text>
                  )}

                  <Text style={styles.detailText}>
                    {item.shares.toLocaleString()} 股 | 買入均價 {sym}{item.avgCost.toLocaleString()} ➔ 現價 {sym}{item.currentPrice.toLocaleString()}
                  </Text>
                  
                  {!isUS && (
                    <Text style={styles.feeBreakdownText}>
                      成本: {sym}{Math.round(totalCost).toLocaleString()} (含買進費${buyFee.toLocaleString()}) | 預估賣出費用: 費${sellFee.toLocaleString()} + 稅${tax.toLocaleString()}
                    </Text>
                  )}
                </View>

                <View style={{ alignItems: 'flex-end', marginRight: 16 }}>
                  <Text style={styles.stockPrice}>{sym}{Math.round(totalVal).toLocaleString()}</Text>
                  
                  <Text style={[styles.detailText, pl >= 0 ? styles.profit : styles.loss, { fontWeight: 'bold' }]}>
                    {pl >= 0 ? '獲利 +' : '虧損 -'}{sym}{Math.abs(Math.round(pl)).toLocaleString()} ({roi.toFixed(2)}%)
                  </Text>

                  {item.lastUpdated ? (
                    <Text style={styles.timeTag}>更新: {item.lastUpdated}</Text>
                  ) : null}
                </View>

                <View style={styles.itemActionGroup}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => handleOpenDividend(item)}>
                    <Text style={styles.editBtnText}>領股息</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.sellBtn} onPress={() => handleOpenSell(item)}>
                    <Text style={styles.sellBtnText}>賣出結算</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editBtn} onPress={() => handleOpenEdit(item)}>
                    <Text style={styles.editBtnText}>編輯</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )
      ) : (
        filteredHistoryTrades.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>【尚無符合條件之歷史結算紀錄】</Text>
          </View>
        ) : (
          filteredHistoryTrades.map((item) => {
            const isUS = item.currency === 'USD' || item.market === 'US';
            const sym = isUS ? '$' : 'NT$';
            const hasRebate = (item.rebateAmount || 0) > 0;
            const gross = item.grossRevenue || item.sellPrice * item.shares;
            const actualReceived = item.grossRevenue 
              ? (gross - (item.originalSellFee || 0) - (item.tax || 0))
              : (gross - (item.discountedSellFee || 0) - (item.tax || 0));

            return (
              <View key={item.id} style={styles.historyListItem}>
                <View style={{ flex: 1 }}>
                  <View style={styles.codeRow}>
                    <Text style={styles.stockCode}>{item.code} // {item.name} {item.isDayTrade && '【現股當沖】'}</Text>
                    <View style={[styles.marketBadge, isUS ? styles.badgeUS : styles.badgeTW]}>
                      <Text style={styles.marketBadgeText}>{isUS ? '美股' : '台股'}</Text>
                    </View>
                    {item.isDCA && (
                      <View style={styles.badgeDCA}>
                        <Text style={styles.badgeDCAText}>定期定額</Text>
                      </View>
                    )}
                    {item.isETF && (
                      <View style={styles.badgeETF}>
                        <Text style={styles.badgeETFText}>ETF 0.1%稅</Text>
                      </View>
                    )}
                  </View>
                  
                  <Text style={styles.detailText}>
                    賣出時間: {item.sellDate} | {item.shares.toLocaleString()} 股
                  </Text>
                  <Text style={styles.detailText}>
                    成交總額: {sym}{gross.toLocaleString()} | 當下實收現金: {sym}{actualReceived.toLocaleString()}
                  </Text>

                  {hasRebate && (
                    <View style={styles.rebateNoteSmallBox}>
                      <Text style={styles.rebateNoteSmallText}>
                        * 手續費折讓退佣：退回 NT${(item.rebateAmount || 0).toLocaleString()} 元 ({item.rebateDesc || '依券商規則'})
                      </Text>
                      {item.isRebated ? (
                        <Text style={styles.rebatedSuccessTag}>【已退款加回資產】</Text>
                      ) : (
                        <TouchableOpacity 
                          style={styles.claimItemBtn}
                          onPress={() => handleClaimSingleRebate(item.id)}
                        >
                          <Text style={styles.claimItemBtnText}>💰 點此將退佣加回資產</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                <View style={{ alignItems: 'flex-end', minWidth: 120, marginRight: 12 }}>
                  <Text style={[styles.stockPrice, item.netProfit >= 0 ? styles.profit : styles.loss]}>
                    {item.netProfit >= 0 ? `獲利 +${sym}${Math.abs(item.netProfit).toLocaleString()}` : `虧損 -${sym}${Math.abs(item.netProfit).toLocaleString()}`}
                  </Text>
                  <Text style={styles.detailText}>買進 {sym}{item.buyPrice.toLocaleString()} ➔ 賣出 {sym}{item.sellPrice.toLocaleString()}</Text>
                </View>

                <View style={styles.itemActionGroup}>
                  <TouchableOpacity 
                    style={styles.deleteHistoryBtn} 
                    onPress={() => handleDeleteHistoryTrade(item.id)}
                  >
                    <Text style={styles.deleteHistoryBtnText}>🗑️ 刪除紀錄</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )
      )}

      {/* 拆筆流水帳完整明細 Modal */}
      <Modal animationType="slide" transparent={false} visible={ledgerFullScreenVisible} onRequestClose={() => setLedgerFullScreenVisible(false)}>
        <View style={styles.fullScreenModalContainer}>
          <View style={styles.fullScreenHeader}>
            <View>
              <Text style={styles.fullScreenTitle}>📊 拆筆流水帳完整明細紀錄 (按天數排)</Text>
              <Text style={styles.fullScreenSubtitle}>完整檢視所有買賣交割、手續費、證交稅、退佣與現金股利之拆筆金流明細</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.downloadCsvBtn} onPress={handleDownloadCSV}>
                <Text style={styles.downloadCsvBtnText}>📥 下載 CSV 紀錄 (受區間影響)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fullScreenCloseBtn} onPress={() => setLedgerFullScreenVisible(false)}>
                <Text style={styles.fullScreenCloseBtnText}>[關閉並返回 ✕]</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.timeRangeFilterBar}>
            <Text style={styles.timeRangeFilterLabel}>📅 時間範圍區間：</Text>
            <View style={styles.timeRangeBtnGroup}>
              {(['7d', '1m', '3m', '6m', '1y', '5y', '10y', 'custom'] as const).map((range) => {
                const labelMap = {
                  '7d': '近7天',
                  '1m': '1個月',
                  '3m': '3個月',
                  '6m': '6個月',
                  '1y': '1年',
                  '5y': '5年',
                  '10y': '10年',
                  'custom': '📌 自訂區間'
                };
                const isActive = ledgerTimeRange === range;
                return (
                  <TouchableOpacity
                    key={range}
                    style={[styles.timeRangeBtn, isActive && styles.timeRangeBtnActive]}
                    onPress={() => setLedgerTimeRange(range)}
                  >
                    <Text style={[styles.timeRangeBtnText, isActive && styles.timeRangeBtnTextActive]}>
                      {labelMap[range]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {ledgerTimeRange === 'custom' && (
              <View style={styles.customDateContainer}>
                <View style={styles.customDateInputGroup}>
                  <Text style={styles.customDateLabel}>從：</Text>
                  {Platform.OS === 'web' ? (
                    <input 
                      type="date"
                      min="2000-01-01"
                      max={customEndDate}
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      style={webDateSmallStyle}
                    />
                  ) : (
                    <TextInput 
                      style={styles.customDateTextInput} 
                      value={customStartDate} 
                      onChangeText={setCustomStartDate} 
                    />
                  )}
                </View>

                <View style={styles.customDateInputGroup}>
                  <Text style={styles.customDateLabel}>至：</Text>
                  {Platform.OS === 'web' ? (
                    <input 
                      type="date"
                      min="2000-01-01"
                      max={customEndDate}
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      style={webDateSmallStyle}
                    />
                  ) : (
                    <TextInput 
                      style={styles.customDateTextInput} 
                      value={customEndDate} 
                      onChangeText={setCustomEndDate} 
                    />
                  )}
                </View>
                <Text style={styles.customDateTip}>
                  (最早 2000-01-01，最晚至今日 {customEndDate})
                </Text>
              </View>
            )}
          </View>

          <ScrollView contentContainerStyle={styles.fullScreenContent}>
            {groupedLedgerEntries.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>【此時間範圍內尚無結算拆筆流水帳資料】</Text>
              </View>
            ) : (
              groupedLedgerEntries.map((group, groupIndex) => (
                <View key={group.day} style={{ marginBottom: 24 }}>
                  {groupIndex > 0 && (
                    <Text style={styles.ledgerSeparatorLine}>----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------</Text>
                  )}
                  <Text style={styles.ledgerDateHeader}>------{group.day}-----</Text>

                  <View style={styles.tableContainer}>
                    <View style={styles.tableHeaderRow}>
                      <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>日期時間</Text>
                      <Text style={[styles.tableHeaderCell, { flex: 1 }]}>交易類別</Text>
                      <Text style={[styles.tableHeaderCell, { flex: 1 }]}>標的名稱</Text>
                      <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>金流金額</Text>
                      <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>備註說明</Text>
                    </View>

                    {group.entries.map((row) => (
                      <View key={row.id} style={styles.tableDataRow}>
                        <Text style={[styles.tableCell, { flex: 1.2 }]}>{row.date}</Text>
                        <Text style={[styles.tableCell, { flex: 1, fontWeight: 'bold' }]}>{row.typeName}</Text>
                        <Text style={[styles.tableCell, { flex: 1 }]}>{row.code} ({row.name})</Text>
                        <Text style={[
                          styles.tableCell, 
                          { flex: 1, textAlign: 'right', fontWeight: 'bold' },
                          row.amount >= 0 ? styles.profit : styles.loss
                        ]}>
                          {row.amount >= 0 ? `+NT$${row.amount.toLocaleString()}` : `-NT$${Math.abs(row.amount).toLocaleString()}`}
                        </Text>
                        <Text style={[styles.tableCellSub, { flex: 1.5, textAlign: 'right' }]}>{row.note}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={recordExplainModalVisible} onRequestClose={() => setRecordExplainModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 紀錄頁面與資產計算完整說明</Text>
              
              <View style={styles.explainSection}>
                <Text style={styles.explainHeader}>1. 總資產計算公式 (例如: $5,000)</Text>
                <Text style={styles.explainText}>
                  • **總資產 ($5,000)** = **可用現金** + **股票當前總市值**{'\n'}
                  • 當您賣出股票時，賣出獲得的現金會自動歸還加回「可用現金」中。{'\n'}
                  • 如果購買美股，系統會依據即時匯率折算為新台幣計入總資產。
                </Text>

                <Text style={styles.explainHeader}>2. 結算紀錄每一筆欄位意義</Text>
                <Text style={styles.explainText}>
                  • **成交總額**：賣出價格 × 賣出股數。{'\n'}
                  • **當下實收現金**：扣除證交稅與券商手續費後，實際入帳至您帳戶的金額。{'\n'}
                  • **淨損益 (+/-)**：扣除買進成本、賣出成本與規費後的真實淨獲利或虧損。{'\n'}
                  • **手續費折讓退佣**：若是日退/月退券商，折讓退款會在到期時自動加回可用現金。
                </Text>
              </View>

              <Pressable style={styles.closeBtn} onPress={() => setRecordExplainModalVisible(false)}>
                <Text style={styles.closeBtnText}>[了解，關閉視窗]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={addModalVisible} onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 新增持股部位 (支援一般委託與定期定額)</Text>

              <View style={styles.marketSelectorRow}>
                <TouchableOpacity 
                  style={[styles.marketSelectBtn, formMarket === 'TW' && styles.marketSelectBtnActive]}
                  onPress={() => setFormMarket('TW')}
                >
                  <Text style={[styles.marketSelectBtnText, formMarket === 'TW' && styles.marketSelectBtnTextActive]}>
                    🇹🇼 台灣股市
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.marketSelectBtn, formMarket === 'US' && styles.marketSelectBtnActive]}
                  onPress={() => setFormMarket('US')}
                >
                  <Text style={[styles.marketSelectBtnText, formMarket === 'US' && styles.marketSelectBtnTextActive]}>
                    🇺🇸 美國股市
                  </Text>
                </TouchableOpacity>
              </View>

              {formMarket === 'TW' && (
                <View style={styles.dcaSelectorContainer}>
                  <Text style={styles.label}>交易方式 / 委託類別：</Text>
                  <View style={styles.dcaSelectorRow}>
                    <TouchableOpacity 
                      style={[styles.dcaSelectBtn, !formIsDCA && styles.dcaSelectBtnActive]}
                      onPress={() => setFormIsDCA(false)}
                    >
                      <Text style={[styles.dcaSelectBtnText, !formIsDCA && styles.dcaSelectBtnTextActive]}>
                        💼 一般交易 (整股 / 零股)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.dcaSelectBtn, formIsDCA && styles.dcaSelectBtnActiveDCA]}
                      onPress={() => setFormIsDCA(true)}
                    >
                      <Text style={[styles.dcaSelectBtnText, formIsDCA && styles.dcaSelectBtnTextActiveDCA]}>
                        ⏳ 定期定額 (DCA 存股)
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {formIsDCA && (
                    <Text style={styles.dcaTipText}>
                      💡 已啟用【定期定額】：依各大券商存股優惠，扣款 1 萬元內買進手續費只要 1 元均一價！
                    </Text>
                  )}
                </View>
              )}

              <Text style={styles.label}>股票代號</Text>
              <View style={styles.inputWithActionRow}>
                <TextInput 
                  style={[styles.inputLarge, { flex: 1, marginBottom: 0 }]} 
                  value={formCode} 
                  onChangeText={handleCodeChange}
                  onBlur={() => handleTriggerFetchQuote()}
                  placeholder={formMarket === 'TW' ? "例如：2330、0050、8069" : "例如：NVDA、AAPL、TSLA"} 
                  placeholderTextColor="#404040" 
                  autoCapitalize="characters"
                />
                <TouchableOpacity 
                  style={[styles.inlineFetchBtn, isFetchingQuote && { opacity: 0.6 }]} 
                  onPress={() => handleTriggerFetchQuote()}
                  disabled={isFetchingQuote}
                >
                  {isFetchingQuote ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.inlineFetchBtnText}>⚡ 即時抓取</Text>}
                </TouchableOpacity>
              </View>

              {quoteStatusMsg.text ? (
                <View style={[styles.statusBox, quoteStatusMsg.type === 'success' ? styles.statusBoxSuccess : quoteStatusMsg.type === 'error' ? styles.statusBoxError : styles.statusBoxLoading]}>
                  <Text style={styles.statusBoxText}>{quoteStatusMsg.text}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>股票名稱</Text>
              <TextInput style={styles.inputLarge} value={formName} onChangeText={setFormName} placeholder="例如：台積電、元大台灣50" placeholderTextColor="#404040" />

              <View style={styles.responsiveGrid}>
                <View style={styles.gridCol}>
                  <Text style={styles.label}>購入日期</Text>
                  {Platform.OS === 'web' ? (
                    <input 
                      type="date"
                      min="2000-01-01"
                      max={customEndDate}
                      value={formBuyDate} 
                      onChange={(e) => setFormBuyDate(e.target.value)} 
                      style={webInputStyle}
                    />
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyDate} onChangeText={setFormBuyDate} />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>小時 (Hour)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={formBuyHour}
                      onChange={(e) => setFormBuyHour(e.target.value)}
                      style={webInputStyle}
                    >
                      {addHourOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyHour} onChangeText={setFormBuyHour} />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>分鐘 (Minute)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={formBuyMinute}
                      onChange={(e) => setFormBuyMinute(e.target.value)}
                      style={webInputStyle}
                    >
                      {addMinuteOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyMinute} onChangeText={setFormBuyMinute} />
                  )}
                </View>
              </View>

              {formWarningMsg ? (
                <View style={styles.warningBoxAlert}>
                  <Text style={styles.warningText}>{formWarningMsg}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>買入股數 (自動帶入千分位)</Text>
              <TextInput 
                style={styles.inputLarge} 
                value={formShares} 
                onChangeText={(val) => setFormShares(formatWithCommas(val))} 
                keyboardType="numeric" 
                placeholder="例如: 1,000" 
                placeholderTextColor="#404040" 
              />

              <Text style={styles.label}>買入成本單價 ({currSymbol}) (自動帶入千分位)</Text>
              <TextInput 
                style={styles.inputLarge} 
                value={formAvgCost} 
                onChangeText={(val) => setFormAvgCost(formatWithCommas(val))} 
                keyboardType="numeric" 
                placeholder="例如: 109" 
                placeholderTextColor="#404040" 
              />

              <Text style={styles.label}>目前即時單價 ({currSymbol} - 系統自動連線抓取，亦可手動調整)</Text>
              <TextInput 
                style={styles.inputLarge} 
                value={formCurrentPrice} 
                onChangeText={(val) => setFormCurrentPrice(formatWithCommas(val))} 
                keyboardType="numeric" 
                placeholder="例如: 108.9" 
                placeholderTextColor="#404040" 
              />

              {previewShares > 0 && previewCostUnit > 0 ? (
                <View style={styles.previewBox}>
                  <View style={styles.previewHeaderRow}>
                    <Text style={styles.previewTitle}>📊 精確試算損益 (套用 {currentBroker.name})</Text>
                    <View style={[styles.previewBadge, previewCalc.pl >= 0 ? styles.badgeProfit : styles.badgeLoss]}>
                      <Text style={styles.previewBadgeText}>{previewCalc.pl >= 0 ? '預估獲利' : '預估虧損'}</Text>
                    </View>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>買入總成本:</Text>
                    <Text style={styles.previewValue}>{currSymbol}{Math.round(previewCalc.totalCost).toLocaleString()} 元 (含手續費${previewCalc.buyFee.toLocaleString()}{formIsDCA ? '【定期定額1元】' : ''})</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>預估賣出費用:</Text>
                    <Text style={styles.previewValue}>手續費${previewCalc.sellFee.toLocaleString()} + 證交稅${previewCalc.tax.toLocaleString()} ({previewCalc.isETF ? 'ETF 0.1%減徵' : '個股 0.3%'})</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>試算預估淨損益:</Text>
                    <Text style={[styles.previewValueHighlight, previewCalc.pl >= 0 ? styles.profit : styles.loss]}>
                      {previewCalc.pl >= 0 ? '獲利 +' : '虧損 -'}{currSymbol}{Math.abs(Math.round(previewCalc.pl)).toLocaleString()} ({previewCalc.roi.toFixed(2)}%)
                    </Text>
                  </View>
                </View>
              ) : null}

              {formErrorMsg ? (
                <View style={styles.errorBoxAlert}>
                  <Text style={styles.errorText}>{formErrorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.confirmBtn} onPress={handleAddHolding}>
                <Text style={styles.confirmBtnText}>確認新增部位</Text>
              </TouchableOpacity>
              <Pressable style={styles.closeBtn} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.closeBtnText}>[取消]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={editModalVisible} onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 編輯部位 - {formName} ({formCode})</Text>

              {formMarket === 'TW' && (
                <View style={styles.dcaSelectorContainer}>
                  <Text style={styles.label}>交易方式 / 委託類別：</Text>
                  <View style={styles.dcaSelectorRow}>
                    <TouchableOpacity 
                      style={[styles.dcaSelectBtn, !formIsDCA && styles.dcaSelectBtnActive]}
                      onPress={() => setFormIsDCA(false)}
                    >
                      <Text style={[styles.dcaSelectBtnText, !formIsDCA && styles.dcaSelectBtnTextActive]}>
                        💼 一般交易
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.dcaSelectBtn, formIsDCA && styles.dcaSelectBtnActiveDCA]}
                      onPress={() => setFormIsDCA(true)}
                    >
                      <Text style={[styles.dcaSelectBtnText, formIsDCA && styles.dcaSelectBtnTextActiveDCA]}>
                        ⏳ 定期定額 (1元手續費)
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <Text style={styles.label}>股票名稱</Text>
              <TextInput style={styles.inputLarge} value={formName} onChangeText={setFormName} />

              <View style={styles.responsiveGrid}>
                <View style={styles.gridCol}>
                  <Text style={styles.label}>購入日期</Text>
                  {Platform.OS === 'web' ? (
                    <input 
                      type="date"
                      min="2000-01-01"
                      max={customEndDate}
                      value={formBuyDate} 
                      onChange={(e) => setFormBuyDate(e.target.value)} 
                      style={webInputStyle}
                    />
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyDate} onChangeText={setFormBuyDate} />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>小時 (Hour)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={formBuyHour}
                      onChange={(e) => setFormBuyHour(e.target.value)}
                      style={webInputStyle}
                    >
                      {addHourOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyHour} onChangeText={setFormBuyHour} />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>分鐘 (Minute)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={formBuyMinute}
                      onChange={(e) => setFormBuyMinute(e.target.value)}
                      style={webInputStyle}
                    >
                      {addMinuteOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={formBuyMinute} onChangeText={setFormBuyMinute} />
                  )}
                </View>
              </View>

              {formWarningMsg ? (
                <View style={styles.warningBoxAlert}>
                  <Text style={styles.warningText}>{formWarningMsg}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>持股股數 (自動帶入千分位)</Text>
              <TextInput style={styles.inputLarge} value={formShares} onChangeText={(val) => setFormShares(formatWithCommas(val))} keyboardType="numeric" />

              <Text style={styles.label}>買入成本單價 ({currSymbol}) (自動帶入千分位)</Text>
              <TextInput style={styles.inputLarge} value={formAvgCost} onChangeText={(val) => setFormAvgCost(formatWithCommas(val))} keyboardType="numeric" />

              <View style={styles.inputWithActionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>最新即時單價 ({currSymbol}) (自動帶入千分位)</Text>
                  <TextInput style={[styles.inputLarge, { marginBottom: 0 }]} value={formCurrentPrice} onChangeText={(val) => setFormCurrentPrice(formatWithCommas(val))} keyboardType="numeric" />
                </View>
                <TouchableOpacity 
                  style={[styles.inlineFetchBtn, { alignSelf: 'flex-end' }]} 
                  onPress={() => handleTriggerFetchQuote(formCode)}
                >
                  <Text style={styles.inlineFetchBtnText}>⚡ 即時更新</Text>
                </TouchableOpacity>
              </View>

              {quoteStatusMsg.text ? (
                <View style={[styles.statusBox, styles.statusBoxSuccess, { marginTop: 10 }]}>
                  <Text style={styles.statusBoxText}>{quoteStatusMsg.text}</Text>
                </View>
              ) : null}

              {previewShares > 0 && previewCostUnit > 0 ? (
                <View style={[styles.previewBox, { marginTop: 12 }]}>
                  <Text style={styles.previewTitle}>📊 目前損益試算 (套用 {currentBroker.name})</Text>
                  <Text style={[styles.previewValueHighlight, previewCalc.pl >= 0 ? styles.profit : styles.loss, { marginTop: 4 }]}>
                    {previewCalc.pl >= 0 ? '獲利 +' : '虧損 -'}{currSymbol}{Math.abs(Math.round(previewCalc.pl)).toLocaleString()} ({previewCalc.roi.toFixed(2)}%)
                  </Text>
                  <Text style={[styles.detailText, { marginTop: 4 }]}>
                    買進費${previewCalc.buyFee.toLocaleString()} | 預估賣出費${previewCalc.sellFee.toLocaleString()} | 預估稅${previewCalc.tax.toLocaleString()}
                  </Text>
                </View>
              ) : null}

              {formErrorMsg ? (
                <View style={styles.errorBoxAlert}>
                  <Text style={styles.errorText}>{formErrorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveEdit}>
                <Text style={styles.confirmBtnText}>儲存修改</Text>
              </TouchableOpacity>
              {selectedHolding && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteHolding(selectedHolding.id)}>
                  <Text style={styles.deleteBtnText}>刪除此筆部位</Text>
                </TouchableOpacity>
              )}
              <Pressable style={styles.closeBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.closeBtnText}>[取消]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* 領股息 Modal 視窗（已優化清晰度與加入發放日期選擇） */}
      <Modal animationType="fade" transparent={true} visible={dividendModalVisible} onRequestClose={() => setDividendModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 記錄現金股利領取 - {selectedHolding?.name} ({selectedHolding?.code})</Text>
              
              <View style={styles.dividendInfoRow}>
                <Text style={styles.dividendInfoLabel}>目前持有股數：</Text>
                <Text style={styles.dividendInfoVal}>{selectedHolding?.shares.toLocaleString()} 股</Text>
              </View>
              
              <View style={styles.dividendInfoRow}>
                <Text style={styles.dividendInfoLabel}>股票買入日期：</Text>
                <Text style={styles.dividendInfoVal}>{(selectedHolding?.buyDate || '').split(' ')[0]}</Text>
              </View>

              <Text style={styles.label}>(1) 選擇股息發放日期 (必須大於或等於買入日期)：</Text>
              {Platform.OS === 'web' ? (
                <input 
                  type="date"
                  min={(selectedHolding?.buyDate || '2000-01-01').split(' ')[0]}
                  max={todayTaiwanStr}
                  value={dividendDateInput}
                  onChange={(e) => {
                    setDividendDateInput(e.target.value);
                    setDividendErrorMsg('');
                  }}
                  style={webInputStyle}
                />
              ) : (
                <TextInput 
                  style={styles.inputLarge} 
                  value={dividendDateInput} 
                  onChangeText={(val) => {
                    setDividendDateInput(val);
                    setDividendErrorMsg('');
                  }} 
                />
              )}

              <Text style={styles.label}>(2) 每股配發股息金額 (現金股利)：</Text>
              <TextInput 
                style={styles.inputLarge} 
                value={dividendPerShareInput} 
                onChangeText={(val) => {
                  setDividendPerShareInput(val);
                  setDividendErrorMsg('');
                }} 
                keyboardType="numeric" 
                placeholder="例如: 1.5 或 3.2" 
                placeholderTextColor="#737373" 
              />

              {dividendPerShareInput && parseNumber(dividendPerShareInput) > 0 ? (
                <View style={styles.dividendPreviewCard}>
                  <Text style={styles.dividendPreviewTitle}>📊 股利入帳總額試算</Text>
                  <Text style={styles.dividendPreviewResult}>
                    +NT${Math.round((selectedHolding?.shares || 0) * parseNumber(dividendPerShareInput)).toLocaleString()} 元
                  </Text>
                  <Text style={styles.dividendPreviewSub}>
                    發放日期：{dividendDateInput} (將自動計入可用現金與總資產)
                  </Text>
                </View>
              ) : null}

              {dividendErrorMsg ? (
                <View style={styles.errorBoxAlert}>
                  <Text style={styles.errorText}>{dividendErrorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmDividend}>
                <Text style={styles.confirmBtnText}>確認入帳現金股利</Text>
              </TouchableOpacity>
              <Pressable style={styles.closeBtn} onPress={() => setDividendModalVisible(false)}>
                <Text style={styles.closeBtnText}>[取消]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={sellModalVisible} onRequestClose={() => setSellModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 賣出部位與損益結算 - {selectedHolding?.name} ({selectedHolding?.code})</Text>
              
              <Text style={styles.label}>賣出價格 ({selectedHolding?.currency === 'USD' ? '美元 USD' : '新台幣 TWD'}) (自動帶入千分位)</Text>
              <TextInput 
                style={styles.inputLarge} 
                value={sellPriceInput} 
                onChangeText={(val) => setSellPriceInput(formatWithCommas(val))} 
                keyboardType="numeric" 
              />
              
              <Text style={styles.label}>賣出股數 (最大可賣: {selectedHolding?.shares.toLocaleString()} 股) (自動帶入千分位)</Text>
              <TextInput 
                style={[
                  styles.inputLarge, 
                  isSharesOverLimit && styles.inputErrorBorder
                ]} 
                value={sellSharesInput} 
                onChangeText={(val) => {
                  setSellSharesInput(formatWithCommas(val));
                  setSellErrorMsg('');
                }} 
                keyboardType="numeric" 
              />
              {isSharesOverLimit && (
                <Text style={styles.errorText}>
                  ❌ 賣出股數 ({sShares.toLocaleString()}股) 不能大於實際持有股數 ({selectedHolding?.shares.toLocaleString()}股)！
                </Text>
              )}

              <View style={styles.responsiveGrid}>
                <View style={styles.gridCol}>
                  <Text style={styles.label}>賣出日期</Text>
                  {Platform.OS === 'web' ? (
                    <input 
                      type="date"
                      min="2000-01-01"
                      max={customEndDate}
                      value={sellDateInput} 
                      onChange={(e) => {
                        setSellDateInput(e.target.value);
                        setSellErrorMsg('');
                      }} 
                      style={webInputStyle}
                    />
                  ) : (
                    <TextInput 
                      style={styles.inputLarge} 
                      value={sellDateInput} 
                      onChangeText={(val) => {
                        setSellDateInput(val);
                        setSellErrorMsg('');
                      }} 
                    />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>小時 (Hour)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={sellHour}
                      onChange={(e) => setSellHour(e.target.value)}
                      style={webInputStyle}
                    >
                      {sellHourOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={sellHour} onChangeText={setSellHour} />
                  )}
                </View>

                <View style={styles.gridCol}>
                  <Text style={styles.label}>分鐘 (Minute)</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={sellMinute}
                      onChange={(e) => setSellMinute(e.target.value)}
                      style={webInputStyle}
                    >
                      {sellMinuteOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} style={{ backgroundColor: '#171717', color: '#fff' }}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TextInput style={styles.inputLarge} value={sellMinute} onChangeText={setSellMinute} />
                  )}
                </View>
              </View>

              {sellWarningMsg ? (
                <View style={styles.warningBoxAlert}>
                  <Text style={styles.warningText}>{sellWarningMsg}</Text>
                </View>
              ) : null}

              {sellErrorMsg ? (
                <View style={styles.errorBoxAlert}>
                  <Text style={styles.errorText}>{sellErrorMsg}</Text>
                </View>
              ) : null}

              {selectedHolding?.market !== 'US' && (
                <View style={styles.sellModeContainer}>
                  <Text style={styles.label}>交易委託模式選擇：</Text>
                  <View style={styles.sellModeRow}>
                    <TouchableOpacity 
                      style={[styles.sellModeBtn, sellTradeMode === 'normal' && styles.sellModeBtnActive]}
                      onPress={() => setSellTradeMode('normal')}
                    >
                      <Text style={[styles.sellModeBtnText, sellTradeMode === 'normal' && styles.sellModeBtnTextActive]}>
                        💼 一般交易
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.sellModeBtn, sellTradeMode === 'dayTrade' && styles.sellModeBtnActiveDayTrade]}
                      onPress={() => setSellTradeMode('dayTrade')}
                    >
                      <Text style={[styles.sellModeBtnText, sellTradeMode === 'dayTrade' && styles.sellModeBtnTextActiveDayTrade]}>
                        ⚡ 現股當沖
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.sellModeBtn, sellTradeMode === 'dca' && styles.sellModeBtnActiveDCA]}
                      onPress={() => setSellTradeMode('dca')}
                    >
                      <Text style={[styles.sellModeBtnText, sellTradeMode === 'dca' && styles.sellModeBtnTextActiveDCA]}>
                        ⏳ 定期定額
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {sellTradeMode === 'dayTrade' && (
                    <Text style={styles.sellModeTipText}>
                      ⚡ 已切換【現股當沖】：享有賣出證券交易稅減半至 0.15% 優惠稅率！
                    </Text>
                  )}
                  {sellTradeMode === 'dca' && (
                    <Text style={styles.sellModeTipText}>
                      💡 已切換【定期定額】：買進手續費以存股優惠 1 元計入成本！
                    </Text>
                  )}
                  {sellTradeMode === 'normal' && (
                    <Text style={styles.sellModeTipText}>
                      💼 已切換【一般交易】：依{sellIsETF ? 'ETF 0.1%' : '個股標準 0.3%'}稅率計算。
                    </Text>
                  )}
                </View>
              )}

              {sPrice > 0 && sShares > 0 && selectedHolding && !isSharesOverLimit ? (
                <View style={styles.sellCalculationCard}>
                  <View style={styles.sellCardHeader}>
                    <Text style={styles.sellCardTitle}>📋 賣出試算總覽 (套用 {currentBroker.name})</Text>
                    <View style={[styles.previewBadge, sellModalNetProfit >= 0 ? styles.badgeProfit : styles.badgeLoss]}>
                      <Text style={styles.previewBadgeText}>
                        損益狀態: {sellModalNetProfit >= 0 ? '獲利' : '虧損'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.sellCardRow}>
                    <Text style={styles.sellCardLabel}>賣出成交總額:</Text>
                    <Text style={styles.sellCardValue}>{sellCurrSym}{sellModalGross.toLocaleString()} 元</Text>
                  </View>

                  {!sellIsUS && (
                    <>
                      <View style={styles.sellCardRow}>
                        <Text style={styles.sellCardLabel}>
                          證交稅 ({(sellModalTaxRate * 100).toFixed(1)}% {sellIsETF ? 'ETF減徵優惠' : sellTradeMode === 'dayTrade' ? '當沖優惠' : '個股標準'}):
                        </Text>
                        <Text style={styles.sellCardValue}>-{sellCurrSym}{sellModalTax.toLocaleString()} 元</Text>
                      </View>
                      <View style={styles.sellCardRow}>
                        <Text style={styles.sellCardLabel}>
                          本次交割先扣手續費 ({currentBroker.rebateType === 'instant' ? '現折' : '牌告原價'}):
                        </Text>
                        <Text style={styles.sellCardValue}>
                          -{sellCurrSym}{(currentBroker.rebateType === 'instant' ? sellModalDiscountedFee : sellModalOriginalFee).toLocaleString()} 元
                        </Text>
                      </View>
                    </>
                  )}

                  <View style={styles.sellDivider} />

                  <View style={styles.sellCardRow}>
                    <Text style={styles.sellCardLabelBold}>當下交割實收現金:</Text>
                    <Text style={styles.sellCardValueBold}>{sellCurrSym}{sellModalInitialCash.toLocaleString()} 元</Text>
                  </View>

                  <View style={styles.sellCardRow}>
                    <Text style={styles.sellCardLabelBold}>最終總收益 (含退佣結算):</Text>
                    <Text style={styles.sellCardValueBold}>{sellCurrSym}{sellModalFinalRevenue.toLocaleString()} 元</Text>
                  </View>

                  <View style={styles.sellCardRow}>
                    <Text style={styles.sellCardLabelBold}>損益狀態 (淨損益):</Text>
                    <Text style={[styles.sellCardHighlight, sellModalNetProfit >= 0 ? styles.profit : styles.loss]}>
                      {sellModalNetProfit >= 0 ? '獲利 +' : '虧損 -'}{sellCurrSym}{Math.abs(sellModalNetProfit).toLocaleString()} 元 ({sellModalRoi.toFixed(2)}%)
                    </Text>
                  </View>

                  <View style={styles.smallNoteContainer}>
                    {sellIsUS ? (
                      <Text style={styles.smallNoteText}>
                        * 美股交易免收台灣證交稅，手續費依海外券商或複委託規則直接折讓計入。
                      </Text>
                    ) : currentBroker.rebateType === 'instant' ? (
                      <Text style={styles.smallNoteText}>
                        * 依【{currentBroker.name}】現折規則：交割時已直接依折數折讓手續費 NT${(sellModalOriginalFee - sellModalDiscountedFee).toLocaleString()} 元，實扣手續費僅 NT${sellModalDiscountedFee.toLocaleString()} 元，免等待退佣。
                      </Text>
                    ) : (
                      <Text style={styles.smallNoteText}>
                        * 依【{currentBroker.name}】{currentBroker.rebateType === 'daily' ? '日退' : '月退'}規則：交割時先扣牌告手續費 NT${sellModalOriginalFee.toLocaleString()} 元；{currentBroker.rebateDayDesc}將退回手續費折讓金 NT${sellModalRebate.toLocaleString()} 元並自動加到您的資產中。
                      </Text>
                    )}
                  </View>
                </View>
              ) : null}

              <TouchableOpacity 
                style={[
                  styles.confirmBtn, 
                  isSharesOverLimit && { opacity: 0.5 }
                ]} 
                onPress={handleConfirmSell}
                disabled={isSharesOverLimit}
              >
                <Text style={styles.confirmBtnText}>確認賣出並將結算損益與現金歸檔</Text>
              </TouchableOpacity>
              <Pressable style={styles.closeBtn} onPress={() => setSellModalVisible(false)}>
                <Text style={styles.closeBtnText}>[取消]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={infoModalVisible} onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 大數據券商扣款、ETF稅率與定期定額說明</Text>
              <View style={styles.formulaSection}>
                <Text style={styles.formulaLabel}>1. 定期定額 (DCA) 存股優惠：</Text>
                <Text style={styles.formulaCode}>
                  • 各大券商針對定期定額，每筆扣款 1 萬元內，手續費均一價僅收取 1 元！{'\n'}
                  • 買進時系統自動套用 1 元計算真實成本。
                </Text>

                <Text style={styles.formulaLabel}>2. ETF 證券交易稅減徵優惠：</Text>
                <Text style={styles.formulaCode}>
                  • 股票型 ETF (代號 00 開頭如 0050、0056 等)：證交稅率僅 0.1% (一般個股為 0.3%)。{'\n'}
                  • 債券型 ETF (00...B)：法定免徵證券交易稅 (0%)。
                </Text>

                <Text style={styles.formulaLabel}>3. 零股手續費低消 1 元：</Text>
                <Text style={styles.formulaCode}>
                  • 全台主流券商（國泰、富邦、永豐大戶投、元大、凱基等）零股低消全面調降至 1 元。
                </Text>

                <Text style={styles.formulaLabel}>4. 先扣後退機制 (日退 / 月退)：</Text>
                <Text style={styles.formulaCode}>
                  • 日退券商：次營業日退回折讓款加回資產。{'\n'}
                  • 月退券商：次月固定日退回折讓款加回資產。
                </Text>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => setInfoModalVisible(false)}>
                <Text style={styles.closeBtnText}>[關閉視窗]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={settingsModalVisible} onRequestClose={() => setSettingsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContentLarge}>
              <Text style={styles.modalTitle}>// 使用者 (USER) 控制台與券商選擇</Text>
              
              <View style={settingItemStyle}>
                <Text style={styles.settingLabel}>帳號電子郵件：</Text>
                <Text style={styles.settingValue}>{user?.email || '訪客模式'}</Text>
              </View>

              <View style={settingItemStyle}>
                <Text style={styles.brokerSectionTitle}>🏛️ 選擇您的證券戶 (套用各家正確折扣與退佣方式)：</Text>
                <Text style={styles.brokerSectionSubtitle}>
                  點擊即可切換目前使用券商，系統將立即套用其專屬的手續費折數、整股/零股低消、定期定額優惠以及日退/月退入帳機制。
                </Text>

                <View style={styles.brokerListContainer}>
                  {BROKER_OPTIONS.map((broker) => {
                    const isSelected = currentBroker.id === broker.id;
                    return (
                      <TouchableOpacity
                        key={broker.id}
                        style={[
                          styles.brokerSelectCard,
                          isSelected && styles.brokerSelectCardActive
                        ]}
                        onPress={() => handleSelectBroker(broker.id)}
                      >
                        <View style={styles.brokerCardHeader}>
                          <Text style={[styles.brokerCardName, isSelected && styles.brokerCardNameActive]}>
                            {broker.name}
                          </Text>
                          <View style={styles.brokerBadgesRow}>
                            <View style={styles.discountBadge}>
                              <Text style={styles.discountBadgeText}>
                                {(broker.discount * 10).toFixed(1)}折 · 零股{broker.oddLotMinFee}元 · 定額{broker.dcaMinFee}元
                              </Text>
                            </View>
                            <View style={[
                              styles.rebateTypeBadge, 
                              broker.rebateType === 'instant' ? styles.rebateInstant :
                              broker.rebateType === 'daily' ? styles.rebateDaily : styles.rebateMonthly
                            ]}>
                              <Text style={styles.rebateTypeBadgeText}>
                                {broker.rebateType === 'instant' ? '現折' : broker.rebateType === 'daily' ? '日退' : '月退'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <Text style={styles.brokerCardDesc}>
                          {broker.description}
                        </Text>

                        {isSelected && (
                          <View style={styles.selectedIndicator}>
                            <Text style={styles.selectedIndicatorText}>✓ 目前使用中</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={settingItemStyle}>
                <Text style={styles.settingLabel}>🎯 設定夢想目標年限 (年)</Text>
                <TextInput style={styles.inputLarge} value={inputYears} onChangeText={(val) => setInputYears(formatWithCommas(val))} keyboardType="numeric" placeholder="例如: 3" placeholderTextColor="#404040" />

                <Text style={styles.settingLabel}>🎯 設定夢想目標賺取總金額 (元)</Text>
                <TextInput style={styles.inputLarge} value={inputProfit} onChangeText={(val) => setInputProfit(formatWithCommas(val))} keyboardType="numeric" placeholder="例如: 100,000" placeholderTextColor="#404040" />

                <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveGoal}>
                  <Text style={styles.confirmBtnText}>儲存設定與獲利目標</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.logoutBtn} onPress={() => { setSettingsModalVisible(false); signOut(); }}>
                <Text style={styles.logoutBtnText}>[登出系統]</Text>
              </TouchableOpacity>
              <Pressable style={styles.closeBtn} onPress={() => setSettingsModalVisible(false)}>
                <Text style={styles.closeBtnText}>[關閉設定]</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const webInputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#0a0a0a',
  color: '#ffffff',
  border: '1px solid #262626',
  borderRadius: '6px',
  padding: '12px',
  fontSize: '14px',
  fontFamily: 'monospace',
  marginBottom: '14px',
  boxSizing: 'border-box',
  outline: 'none',
  colorScheme: 'dark',
  cursor: 'pointer',
};

const webDateSmallStyle: React.CSSProperties = {
  backgroundColor: '#0a0a0a',
  color: '#ffffff',
  border: '1px solid #333333',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '12px',
  fontFamily: 'monospace',
  colorScheme: 'dark',
  outline: 'none',
  cursor: 'pointer',
};

const settingItemStyle = { marginVertical: 8, padding: 12, backgroundColor: '#0a0a0a', borderRadius: 6, borderWidth: 1, borderColor: '#262626' };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  contentWrapper: { padding: 16, width: '100%' },

  rebateToast: { backgroundColor: '#052e16', borderWidth: 1, borderColor: '#16a34a', padding: 12, borderRadius: 6, marginBottom: 14 },
  rebateToastText: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },

  highlightCard: { backgroundColor: '#171717', borderRadius: 8, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#404040' },
  highlightCardTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace' },
  clickEditBtn: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', textDecorationLine: 'underline' },
  goalDisplayRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 16, gap: 12 },
  goalDisplayBlock: { minWidth: 120 },
  goalDisplayLabel: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
  goalDisplayValue: { color: '#ffffff', fontSize: 22, fontWeight: 'bold', marginTop: 4, fontFamily: 'monospace' },
  goalDisplayValueHighlight: { color: '#ffffff', fontSize: 26, fontWeight: 'bold', marginTop: 2, fontFamily: 'monospace' },
  progressHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  progressLabel: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  progressBarTrack: { height: 8, backgroundColor: '#0a0a0a', borderRadius: 4, marginTop: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#262626' },
  progressBarFill: { height: '100%', backgroundColor: '#ffffff' },

  card: { backgroundColor: '#121212', borderRadius: 8, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#262626' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
  
  ledgerTopLinkBtn: { backgroundColor: '#1f1f1f', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#3b82f6' },
  ledgerTopLinkBtnText: { color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },

  infoBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  infoBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  totalNetWorth: { color: '#ffffff', fontSize: 32, fontWeight: '700', marginVertical: 12, fontFamily: 'monospace' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 4, gap: 12 },
  plBlock: { minWidth: 160 },
  subText: { color: '#a3a3a3', fontSize: 13, fontFamily: 'monospace' },
  subTitle: { color: '#737373', fontSize: 11, fontFamily: 'monospace' },
  
  recordExplainBtn: { backgroundColor: '#1a1a1a', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  recordExplainBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },

  activeBrokerTag: { backgroundColor: '#171717', borderWidth: 1, borderColor: '#333333', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeBrokerTagText: { color: '#ffffff', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', flex: 1, marginRight: 8 },
  activeBrokerEditLink: { color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', textDecorationLine: 'underline' },

  pendingRebateBanner: { backgroundColor: '#1c1917', borderWidth: 1, borderColor: '#d97706', padding: 14, borderRadius: 8, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  pendingRebateTitle: { color: '#f59e0b', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  pendingRebateSubText: { color: '#a8a29e', fontSize: 11, marginTop: 4, fontFamily: 'monospace' },
  claimAllBtn: { backgroundColor: '#d97706', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  claimAllBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },

  divider: { height: 1, backgroundColor: '#262626', marginVertical: 12 },
  plText: { fontSize: 16, fontWeight: 'bold', marginTop: 4, fontFamily: 'monospace' },
  profit: { color: '#ef4444' },
  loss: { color: '#22c55e' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  tabContainer: { flexDirection: 'row', backgroundColor: '#121212', borderRadius: 6, padding: 4, borderWidth: 1, borderColor: '#262626' },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
  activeTab: { backgroundColor: '#262626' },
  tabText: { fontSize: 12, color: '#737373', fontWeight: '600' },
  activeTabText: { color: '#ffffff' },
  
  btnGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  refreshBtn: { backgroundColor: '#1a1a1a', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 4, borderWidth: 1, borderColor: '#404040', flexDirection: 'row', alignItems: 'center' },
  refreshBtnText: { color: '#e5e5e5', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  addBtn: { backgroundColor: '#262626', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 4, borderWidth: 1, borderColor: '#525252' },
  addBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },

  downloadCsvBtn: { backgroundColor: '#065f46', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#059669' },
  downloadCsvBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },

  fullScreenModalContainer: { flex: 1, backgroundColor: '#0a0a0a', padding: 24 },
  fullScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#262626' },
  fullScreenTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace' },
  fullScreenSubtitle: { color: '#737373', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
  fullScreenCloseBtn: { backgroundColor: '#262626', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#525252' },
  fullScreenCloseBtnText: { color: '#e5e5e5', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  fullScreenContent: { paddingBottom: 40 },

  timeRangeFilterBar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, gap: 8, backgroundColor: '#121212', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#262626' },
  timeRangeFilterLabel: { color: '#a3a3a3', fontSize: 12, fontFamily: 'monospace', fontWeight: 'bold' },
  timeRangeBtnGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timeRangeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333333' },
  timeRangeBtnActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  timeRangeBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },
  timeRangeBtnTextActive: { color: '#ffffff' },

  customDateContainer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4, width: '100%', backgroundColor: '#171717', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#333333' },
  customDateInputGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  customDateLabel: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  customDateTextInput: { backgroundColor: '#0a0a0a', color: '#ffffff', borderWidth: 1, borderColor: '#333333', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, width: 100, fontFamily: 'monospace' },
  customDateTip: { color: '#737373', fontSize: 10, fontFamily: 'monospace' },

  ledgerSeparatorLine: { color: '#404040', fontFamily: 'monospace', fontSize: 13, textAlign: 'center', marginVertical: 16, width: '100%', overflow: 'hidden' },
  ledgerDateHeader: { color: '#60a5fa', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold', marginBottom: 8 },

  stockSummaryContainer: { backgroundColor: '#121212', borderRadius: 8, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#262626' },
  stockSummaryHeader: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace', marginBottom: 10 },
  
  stockChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  stockChip: { backgroundColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#404040' },
  stockChipActive: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  stockChipText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },
  stockChipTextActive: { color: '#ffffff' },

  filterDetailCard: { backgroundColor: '#171717', borderRadius: 6, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#3b82f6' },
  filterDetailTitle: { color: '#60a5fa', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  closeFilterBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', textDecorationLine: 'underline' },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 8 },
  filterGridItem: { color: '#e5e5e5', fontSize: 11, fontFamily: 'monospace', minWidth: 160 },
  filterPlText: { fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace', marginTop: 4 },

  timestampBanner: { backgroundColor: '#171717', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 4, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  timestampText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },

  emptyBox: { padding: 48, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: '#262626', borderRadius: 8 },
  emptyText: { color: '#737373', fontFamily: 'monospace', fontSize: 13, textAlign: 'center' },
  listItem: { backgroundColor: '#121212', padding: 16, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  historyListItem: { backgroundColor: '#121212', padding: 16, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: '#1f1f1f', flexWrap: 'wrap', gap: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stockCode: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', fontFamily: 'monospace' },
  marketBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeTW: { backgroundColor: '#1e3a5f' },
  badgeUS: { backgroundColor: '#3b2064' },
  marketBadgeText: { color: '#ffffff', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' },
  badgeDCA: { backgroundColor: '#78350f', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeDCAText: { color: '#fef3c7', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' },
  badgeETF: { backgroundColor: '#064e3b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeETFText: { color: '#a7f3d0', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' },
  buyDateText: { fontSize: 11, color: '#a3a3a3', marginTop: 3, fontFamily: 'monospace' },
  stockPrice: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', fontFamily: 'monospace' },
  detailText: { fontSize: 11, color: '#a3a3a3', marginTop: 4, fontFamily: 'monospace' },
  feeBreakdownText: { fontSize: 10, color: '#737373', marginTop: 3, fontFamily: 'monospace' },
  timeTag: { fontSize: 9, color: '#525252', marginTop: 2, fontFamily: 'monospace' },

  rebateNoteSmallBox: { marginTop: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#1c1917', borderRadius: 4, borderWidth: 1, borderColor: '#44403c', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  rebateNoteSmallText: { fontSize: 11, color: '#f59e0b', fontFamily: 'monospace' },
  rebatedSuccessTag: { fontSize: 10, color: '#4ade80', fontWeight: 'bold', fontFamily: 'monospace' },
  claimItemBtn: { backgroundColor: '#d97706', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  claimItemBtnText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace' },

  itemActionGroup: { flexDirection: 'row', gap: 8 },
  sellBtn: { backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  sellBtnText: { color: '#ffffff', fontSize: 11, fontFamily: 'monospace' },
  editBtn: { backgroundColor: '#262626', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4 },
  editBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },

  deleteHistoryBtn: { backgroundColor: '#450a0a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#ef4444' },
  deleteHistoryBtnText: { color: '#fca5a5', fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },

  tableContainer: { backgroundColor: '#121212', borderRadius: 8, borderWidth: 1, borderColor: '#262626', overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#1c1c1c', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#333333' },
  tableHeaderCell: { color: '#a3a3a3', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  tableDataRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f', alignItems: 'center' },
  tableCell: { color: '#ffffff', fontSize: 12, fontFamily: 'monospace' },
  tableCellSub: { color: '#737373', fontSize: 11, fontFamily: 'monospace' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  modalContentLarge: { backgroundColor: '#121212', borderRadius: 8, padding: 24, width: '100%', maxWidth: 680, borderWidth: 1, borderColor: '#404040', marginVertical: 20 },
  modalTitle: { fontSize: 15, fontWeight: 'bold', color: '#ffffff', marginBottom: 18, fontFamily: 'monospace' },
  
  dividendInfoRow: { flexDirection: 'row', marginBottom: 6 },
  dividendInfoLabel: { color: '#a3a3a3', fontSize: 12, fontFamily: 'monospace' },
  dividendInfoVal: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  dividendPreviewCard: { backgroundColor: '#171717', borderRadius: 6, padding: 12, marginVertical: 10, borderWidth: 1, borderColor: '#3b82f6' },
  dividendPreviewTitle: { color: '#60a5fa', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace', marginBottom: 4 },
  dividendPreviewResult: { color: '#ef4444', fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace' },
  dividendPreviewSub: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', marginTop: 4 },

  marketSelectorRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  marketSelectBtn: { flex: 1, paddingVertical: 8, borderRadius: 4, alignItems: 'center', backgroundColor: '#171717', borderWidth: 1, borderColor: '#262626' },
  marketSelectBtnActive: { backgroundColor: '#262626', borderColor: '#525252' },
  marketSelectBtnText: { color: '#737373', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  marketSelectBtnTextActive: { color: '#ffffff' },

  dcaSelectorContainer: { marginBottom: 14, backgroundColor: '#141414', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#262626' },
  dcaSelectorRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  dcaSelectBtn: { flex: 1, paddingVertical: 8, borderRadius: 4, alignItems: 'center', backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#333333' },
  dcaSelectBtnActive: { backgroundColor: '#262626', borderColor: '#737373' },
  dcaSelectBtnActiveDCA: { backgroundColor: '#451a03', borderColor: '#d97706' },
  dcaSelectBtnText: { color: '#a3a3a3', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  dcaSelectBtnTextActive: { color: '#ffffff' },
  dcaSelectBtnTextActiveDCA: { color: '#fef3c7' },
  dcaTipText: { color: '#f59e0b', fontSize: 11, fontFamily: 'monospace', marginTop: 8 },

  label: { fontSize: 12, color: '#a3a3a3', marginBottom: 6, fontFamily: 'monospace' },
  inputLarge: { borderWidth: 1, borderColor: '#262626', backgroundColor: '#0a0a0a', borderRadius: 6, padding: 12, fontSize: 14, color: '#ffffff', marginBottom: 14, fontFamily: 'monospace' },
  
  inputErrorBorder: { borderColor: '#ef4444', backgroundColor: '#2a0a0a' },

  errorBoxAlert: { backgroundColor: '#450a0a', borderWidth: 1, borderColor: '#ef4444', padding: 10, borderRadius: 6, marginBottom: 12 },
  errorText: { color: '#fca5a5', fontSize: 12, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 18 },

  warningBoxAlert: { backgroundColor: '#422006', borderWidth: 1, borderColor: '#d97706', padding: 10, borderRadius: 6, marginBottom: 12 },
  warningText: { color: '#fde68a', fontSize: 12, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 18 },

  inputWithActionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  inlineFetchBtn: { backgroundColor: '#262626', borderWidth: 1, borderColor: '#525252', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  inlineFetchBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },

  statusBox: { padding: 8, borderRadius: 4, marginBottom: 12, borderWidth: 1 },
  statusBoxSuccess: { backgroundColor: '#052e16', borderColor: '#166534' },
  statusBoxError: { backgroundColor: '#450a0a', borderColor: '#991b1b' },
  statusBoxLoading: { backgroundColor: '#172554', borderColor: '#1e40af' },
  statusBoxText: { color: '#ffffff', fontSize: 11, fontFamily: 'monospace' },

  previewBox: { backgroundColor: '#171717', borderRadius: 6, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#333333' },
  previewHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#262626' },
  previewTitle: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  previewBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeProfit: { backgroundColor: '#450a0a', borderWidth: 1, borderColor: '#7f1d1d' },
  badgeLoss: { backgroundColor: '#052e16', borderWidth: 1, borderColor: '#166534' },
  previewBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace' },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 },
  previewLabel: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  previewValue: { color: '#ffffff', fontSize: 12, fontFamily: 'monospace' },
  previewValueHighlight: { fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },

  sellModeContainer: { marginBottom: 14, backgroundColor: '#141414', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#262626' },
  sellModeRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  sellModeBtn: { flex: 1, minWidth: 90, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 4, alignItems: 'center', backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#333333' },
  sellModeBtnActive: { backgroundColor: '#262626', borderColor: '#737373' },
  sellModeBtnActiveDayTrade: { backgroundColor: '#451a03', borderColor: '#d97706' },
  sellModeBtnActiveDCA: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  sellModeBtnText: { color: '#a3a3a3', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace' },
  sellModeBtnTextActive: { color: '#ffffff' },
  sellModeBtnTextActiveDayTrade: { color: '#fef3c7' },
  sellModeBtnTextActiveDCA: { color: '#93c5fd' },
  sellModeTipText: { color: '#f59e0b', fontSize: 11, fontFamily: 'monospace', marginTop: 8 },

  sellCalculationCard: { backgroundColor: '#171717', borderRadius: 8, padding: 14, marginVertical: 14, borderWidth: 1, borderColor: '#404040' },
  sellCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sellCardTitle: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  sellCardRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  sellCardLabel: { color: '#a3a3a3', fontSize: 12, fontFamily: 'monospace' },
  sellCardValue: { color: '#ffffff', fontSize: 12, fontFamily: 'monospace' },
  sellCardLabelBold: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  sellCardValueBold: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  sellCardHighlight: { fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace' },
  sellDivider: { height: 1, backgroundColor: '#262626', marginVertical: 8 },

  smallNoteContainer: { marginTop: 10, backgroundColor: '#0a0a0a', padding: 8, borderRadius: 4, borderWidth: 1, borderColor: '#262626' },
  smallNoteText: { color: '#e5e5e5', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },

  responsiveGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  gridCol: { flex: 1, minWidth: 160, paddingHorizontal: 6 },

  explainSection: { backgroundColor: '#0a0a0a', padding: 16, borderRadius: 6, borderWidth: 1, borderColor: '#262626', marginBottom: 16 },
  explainHeader: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace', marginBottom: 6 },
  explainText: { color: '#a3a3a3', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 12 },

  confirmBtn: { backgroundColor: '#262626', paddingVertical: 12, borderRadius: 4, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#525252' },
  confirmBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  deleteBtn: { backgroundColor: '#7f1d1d', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  deleteBtnText: { color: '#fca5a5', fontSize: 12, fontFamily: 'monospace' },
  formulaSection: { backgroundColor: '#0a0a0a', padding: 12, borderRadius: 6, marginBottom: 16, borderWidth: 1, borderColor: '#262626' },
  formulaLabel: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginTop: 8 },
  formulaCode: { fontSize: 11, color: '#e5e5e5', backgroundColor: '#171717', padding: 8, borderRadius: 4, marginTop: 4, fontFamily: 'monospace', lineHeight: 17 },

  brokerSectionTitle: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  brokerSectionSubtitle: { color: '#737373', fontSize: 11, fontFamily: 'monospace', marginTop: 4, marginBottom: 10 },
  brokerListContainer: { marginTop: 6, gap: 8 },
  brokerSelectCard: { backgroundColor: '#141414', borderRadius: 6, padding: 12, borderWidth: 1, borderColor: '#262626' },
  brokerSelectCardActive: { borderColor: '#60a5fa', backgroundColor: '#172554' },
  brokerCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  brokerCardName: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  brokerCardNameActive: { color: '#93c5fd' },
  brokerBadgesRow: { flexDirection: 'row', gap: 6 },
  discountBadge: { backgroundColor: '#262626', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  discountBadgeText: { color: '#ffffff', fontSize: 10, fontFamily: 'monospace' },
  rebateTypeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  rebateInstant: { backgroundColor: '#064e3b' },
  rebateDaily: { backgroundColor: '#1e3a8a' },
  rebateMonthly: { backgroundColor: '#4c1d95' },
  rebateTypeBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace' },
  brokerCardDesc: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace', marginTop: 6, lineHeight: 15 },
  selectedIndicator: { marginTop: 6, alignSelf: 'flex-start' },
  selectedIndicatorText: { color: '#60a5fa', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace' },

  settingLabel: { color: '#737373', fontSize: 11, fontFamily: 'monospace' },
  settingValue: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', marginTop: 4, fontFamily: 'monospace' },
  logoutBtn: { backgroundColor: '#7f1d1d', paddingVertical: 12, borderRadius: 4, alignItems: 'center', marginVertical: 12, borderWidth: 1, borderColor: '#991b1b' },
  logoutBtnText: { color: '#fca5a5', fontWeight: 'bold', fontSize: 12, fontFamily: 'monospace' },
  closeBtn: { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
});