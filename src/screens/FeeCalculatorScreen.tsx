// src/screens/FeeCalculatorScreen.tsx
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, ScrollView, TouchableOpacity, Modal, Pressable } from 'react-native';
import { BROKER_OPTIONS } from '../data/brokers';
import { BrokerConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import { calculateBuyFee, calculateSellFeeAndTax } from '../utils/feeCalculator';

export default function FeeCalculatorScreen() {
  const { profile, updateDefaultBroker } = useAuth();
  
  const [selectedBroker, setSelectedBroker] = useState<BrokerConfig>(BROKER_OPTIONS[0]);
  // 🎯 交易模式按鈕：一般交易 / 現股當沖 / 定期定額
  const [tradeMode, setTradeMode] = useState<'normal' | 'dayTrade' | 'dca'>('normal');
  // 🎯 標的類別：一般個股 (0.3%稅) / ETF 指數型 (0.1%減徵)
  const [assetType, setAssetType] = useState<'stock' | 'etf'>('stock');
  
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [shares, setShares] = useState('1000'); // 預設 1000 股 (1張)，可輸入零股如 60 股

  const [infoModalVisible, setInfoModalVisible] = useState(false);

  useEffect(() => {
    if (profile?.defaultBrokerId) {
      const savedBroker = BROKER_OPTIONS.find((b) => b.id === profile.defaultBrokerId);
      if (savedBroker) setSelectedBroker(savedBroker);
    }
  }, [profile]);

  const handleSelectBroker = (broker: BrokerConfig) => {
    setSelectedBroker(broker);
    updateDefaultBroker(broker.id);
  };

  const bPrice = parseFloat(buyPrice) || 0;
  const sPrice = parseFloat(sellPrice) || 0;
  const numShares = parseInt(shares) || 0;

  const buyAmount = bPrice * numShares;
  const sellAmount = sPrice * numShares;
  const isDCA = tradeMode === 'dca';
  const isDayTrade = tradeMode === 'dayTrade';
  const isETF = assetType === 'etf';
  const stockCode = isETF ? '0050' : '2330';

  // 1. 買進手續費 (大數據精準換算：定期定額 1 萬元內 1 元均一價；零股低消 1 元)
  const buyFeeRes = (bPrice > 0 && numShares > 0)
    ? calculateBuyFee({
        amount: buyAmount,
        shares: numShares,
        broker: selectedBroker,
        isDCA,
        market: 'TW',
      })
    : { discountedFee: 0, originalFee: 0, rebateAmount: 0 };

  const buyFee = buyFeeRes.discountedFee;
  const totalCost = buyAmount + buyFee;

  // 2. 賣出費用與證券交易稅
  const sellFeeRes = (sPrice > 0 && numShares > 0)
    ? calculateSellFeeAndTax({
        code: stockCode,
        amount: sellAmount,
        shares: numShares,
        broker: selectedBroker,
        isDayTrade,
        market: 'TW',
      })
    : { tax: 0, taxRate: isETF ? 0.001 : isDayTrade ? 0.0015 : 0.003, discountedFee: 0, originalFee: 0, rebateAmount: 0 };

  const sellFee = sellFeeRes.discountedFee;
  const tax = sellFeeRes.tax;
  const taxRate = sellFeeRes.taxRate;
  const totalRebate = buyFeeRes.rebateAmount + sellFeeRes.rebateAmount;

  // 3. 損益計算
  const totalRevenue = sellAmount - sellFee - tax;
  const netProfit = (bPrice > 0 && sPrice > 0 && numShares > 0) ? Math.round(totalRevenue - totalCost) : 0;
  const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  // 4. 精確計算保本兩平賣出價
  const calculateBreakEvenPrice = (): number => {
    if (bPrice <= 0 || numShares <= 0) return 0;

    const rawTarget = totalCost / (numShares * (1 - 0.001425 * selectedBroker.discount - taxRate));
    let targetPrice = Math.floor(rawTarget * 100) / 100;

    for (let step = 0; step < 3000; step++) {
      const testAmount = targetPrice * numShares;
      const testFeeRes = calculateSellFeeAndTax({
        code: stockCode,
        amount: testAmount,
        shares: numShares,
        broker: selectedBroker,
        isDayTrade,
        market: 'TW',
      });
      const testRev = testAmount - testFeeRes.discountedFee - testFeeRes.tax;
      if (testRev >= totalCost) {
        return Math.round(targetPrice * 100) / 100;
      }
      targetPrice += 0.01;
    }

    return targetPrice;
  };

  const breakEvenPrice = calculateBreakEvenPrice();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentWrapper}>
      {/* 1. 券商選擇橫條 */}
      <View style={styles.brokerBar}>
        <View style={styles.brokerHeaderRow}>
          <Text style={styles.brokerLabel}>【選擇試算券商戶頭】</Text>
          <TouchableOpacity style={styles.infoBtn} onPress={() => setInfoModalVisible(true)}>
            <Text style={styles.infoBtnText}>[?] 規費與兩平公式</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          {BROKER_OPTIONS.map((broker) => (
            <TouchableOpacity
              key={broker.id}
              style={[styles.brokerChip, selectedBroker.id === broker.id && styles.activeBrokerChip]}
              onPress={() => handleSelectBroker(broker)}
            >
              <Text style={[styles.chipText, selectedBroker.id === broker.id && styles.activeChipText]}>
                {broker.name} ({(broker.discount * 10).toFixed(1)}折)
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 2. 交易模式與標的類別按鈕切換 */}
      <View style={styles.card}>
        <Text style={styles.modeSectionLabel}>交易模式選擇：</Text>
        <View style={styles.modeBtnGroup}>
          <TouchableOpacity 
            style={[styles.modeBtn, tradeMode === 'normal' && styles.modeBtnActive]} 
            onPress={() => setTradeMode('normal')}
          >
            <Text style={[styles.modeBtnText, tradeMode === 'normal' && styles.modeBtnTextActive]}>
              💼 一般交易
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.modeBtn, tradeMode === 'dayTrade' && styles.modeBtnActiveDayTrade]} 
            onPress={() => setTradeMode('dayTrade')}
          >
            <Text style={[styles.modeBtnText, tradeMode === 'dayTrade' && styles.modeBtnTextActiveDayTrade]}>
              ⚡ 現股當沖 (0.15%稅)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.modeBtn, tradeMode === 'dca' && styles.modeBtnActiveDCA]} 
            onPress={() => setTradeMode('dca')}
          >
            <Text style={[styles.modeBtnText, tradeMode === 'dca' && styles.modeBtnTextActiveDCA]}>
              ⏳ 定期定額 (1元手續費)
            </Text>
          </TouchableOpacity>
        </View>

        {/* 標的類別選擇 */}
        <Text style={[styles.modeSectionLabel, { marginTop: 12 }]}>標的類型 (決定證券交易稅率)：</Text>
        <View style={styles.modeBtnGroup}>
          <TouchableOpacity 
            style={[styles.modeBtn, assetType === 'stock' && styles.modeBtnActive]} 
            onPress={() => setAssetType('stock')}
          >
            <Text style={[styles.modeBtnText, assetType === 'stock' && styles.modeBtnTextActive]}>
              🏢 一般股票 ({tradeMode === 'dayTrade' ? '當沖 0.15% 稅' : '標準 0.3% 稅'})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.modeBtn, assetType === 'etf' && styles.modeBtnActiveETF]} 
            onPress={() => setAssetType('etf')}
          >
            <Text style={[styles.modeBtnText, assetType === 'etf' && styles.modeBtnTextActiveETF]}>
              📈 ETF 基金 (法定減徵 0.1% 稅)
            </Text>
          </TouchableOpacity>
        </View>

        {/* 提示訊息 */}
        {tradeMode === 'dca' && (
          <View style={styles.dcaNoticeBox}>
            <Text style={styles.dcaNoticeText}>
              💡 定期定額優惠已套用：每筆扣款 1 萬元內買進手續費只要 1 元均一價！
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* 價格與股數輸入 */}
        <View style={styles.responsiveGrid}>
          <View style={styles.gridCol}>
            <Text style={styles.label}>買入單價 (元)</Text>
            <TextInput style={styles.input} value={buyPrice} onChangeText={setBuyPrice} keyboardType="numeric" placeholder="例如: 109" placeholderTextColor="#404040" />
          </View>
          <View style={styles.gridCol}>
            <Text style={styles.label}>預計賣出單價 (元)</Text>
            <TextInput style={styles.input} value={sellPrice} onChangeText={setSellPrice} keyboardType="numeric" placeholder="例如: 108.9" placeholderTextColor="#404040" />
          </View>
        </View>

        <Text style={styles.label}>交易股數 (支援零股如 60 股，或整股如 1000 股)</Text>
        <TextInput style={styles.input} value={shares} onChangeText={setShares} keyboardType="numeric" placeholder="1000" placeholderTextColor="#404040" />
      </View>

      {/* 3. 試算結果 (台股標準：賺用紅，虧用綠) */}
      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>【交易費用與損益精算結果】</Text>

        <View style={styles.profitBox}>
          <Text style={styles.profitTitle}>預估淨損益 (台股配色：紅漲綠跌)</Text>
          {/* 🎯 賺用紅 (#ef4444)，虧用綠 (#22c55e) */}
          <Text style={[styles.profitAmount, netProfit >= 0 ? styles.profitRed : styles.lossGreen]}>
            {netProfit >= 0 ? '獲利 +' : '虧損 -'}${Math.abs(netProfit).toLocaleString()} 元 ({roi.toFixed(2)}%)
          </Text>
          <Text style={styles.breakEvenText}>
            保本兩平賣出價: <Text style={{ fontWeight: 'bold', color: '#ffffff' }}>${breakEvenPrice.toFixed(2)} 元</Text>
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>買進手續費 {isDCA ? '(定期定額專案 1元均一價)' : `(${(selectedBroker.discount * 10).toFixed(1)}折 / 零股低消${selectedBroker.oddLotMinFee}元)`}</Text>
          <Text style={styles.detailVal}>${buyFee} 元</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>賣出手續費 ({(selectedBroker.discount * 10).toFixed(1)}折 / 零股低消${selectedBroker.oddLotMinFee}元)</Text>
          <Text style={styles.detailVal}>${sellFee} 元</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            證券交易稅 ({((taxRate || 0.003) * 100).toFixed(2)}% {isETF ? 'ETF減徵' : isDayTrade ? '當沖優惠' : '一般個股'})
          </Text>
          <Text style={styles.detailVal}>${tax} 元</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabelBold}>買進總成本 (含手續費)</Text>
          <Text style={styles.detailValBold}>${Math.round(totalCost).toLocaleString()} 元</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabelBold}>賣出實收總收益 (扣除手續費與稅)</Text>
          <Text style={styles.detailValBold}>${Math.round(totalRevenue).toLocaleString()} 元</Text>
        </View>

        {selectedBroker.rebateType !== 'instant' && totalRebate > 0 && (
          <View style={styles.rebateHintBox}>
            <Text style={styles.rebateHintText}>
              * 依【{selectedBroker.name}】{selectedBroker.rebateType === 'daily' ? '日退' : '月退'}規則：交割時先扣牌告手續費，預計退回手續費折讓金 NT${totalRebate} 元 ({selectedBroker.rebateDayDesc}) 並加回您的資產。
            </Text>
          </View>
        )}
      </View>

      {/* 公式說明 Modal */}
      <Modal animationType="fade" transparent={true} visible={infoModalVisible} onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 交易規費與兩平演算架構</Text>
            <ScrollView style={{ maxHeight: 420, marginVertical: 10 }}>
              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>【各大券商真實規費演算法】</Text>
                
                <Text style={styles.formulaLabel}>1. 定期定額 (DCA)：</Text>
                <Text style={styles.formulaCode}>扣款 1 萬元內，各大券商手續費享 1 元均一價！</Text>

                <Text style={styles.formulaLabel}>2. 零股交易低消：</Text>
                <Text style={styles.formulaCode}>全台券商零股交易手續費低消全面降至 1 元。</Text>

                <Text style={styles.formulaLabel}>3. 證券交易稅率：</Text>
                <Text style={styles.formulaCode}>
                  • 一般股票：0.3%{'\n'}
                  • 現股當沖：0.15%{'\n'}
                  • ETF (00開頭)：0.1% 法定減徵優惠{'\n'}
                  • 債券型 ETF：0% 免稅
                </Text>

                <Text style={styles.formulaLabel}>4. 保本兩平賣出價：</Text>
                <Text style={styles.formulaCode}>精確計算涵蓋手續費低消、折讓與證交稅後，淨損益不小於 0 的最小賣出單價。</Text>
              </View>

              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>【各大券商折數與退佣機制】</Text>
                {BROKER_OPTIONS.map((b) => (
                  <View key={b.id} style={styles.modalBrokerRow}>
                    <Text style={styles.modalBrokerName}>{b.name}</Text>
                    <Text style={styles.modalBrokerDetail}>
                      折數：{(b.discount * 10).toFixed(1)}折 | 零股低消：${b.oddLotMinFee}元 | 定額：${b.dcaMinFee}元 | 【{b.rebateDayDesc}】
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <Pressable style={styles.closeBtn} onPress={() => setInfoModalVisible(false)}>
              <Text style={styles.closeBtnText}>[關閉視窗]</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  contentWrapper: { padding: 16, width: '100%' },
  brokerBar: { backgroundColor: '#121212', padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  brokerHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brokerLabel: { fontSize: 12, color: '#737373', fontFamily: 'monospace' },
  infoBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  infoBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  brokerChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0a0a0a', borderRadius: 4, marginRight: 8, borderWidth: 1, borderColor: '#262626' },
  activeBrokerChip: { backgroundColor: '#262626', borderColor: '#60a5fa' },
  chipText: { fontSize: 11, color: '#737373', fontFamily: 'monospace' },
  activeChipText: { color: '#ffffff', fontWeight: 'bold' },

  card: { backgroundColor: '#121212', padding: 16, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  modeSectionLabel: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginBottom: 8, fontFamily: 'monospace' },
  modeBtnGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modeBtn: { flex: 1, minWidth: 100, paddingVertical: 8, paddingHorizontal: 6, backgroundColor: '#171717', borderRadius: 4, alignItems: 'center', borderWidth: 1, borderColor: '#262626' },
  modeBtnActive: { backgroundColor: '#262626', borderColor: '#737373' },
  modeBtnActiveDayTrade: { backgroundColor: '#451a03', borderColor: '#d97706' },
  modeBtnActiveDCA: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  modeBtnActiveETF: { backgroundColor: '#064e3b', borderColor: '#10b981' },
  modeBtnText: { color: '#737373', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace' },
  modeBtnTextActive: { color: '#ffffff' },
  modeBtnTextActiveDayTrade: { color: '#fef3c7' },
  modeBtnTextActiveDCA: { color: '#93c5fd' },
  modeBtnTextActiveETF: { color: '#a7f3d0' },

  dcaNoticeBox: { marginTop: 10, backgroundColor: '#141414', padding: 8, borderRadius: 4, borderWidth: 1, borderColor: '#1e3a5f' },
  dcaNoticeText: { color: '#93c5fd', fontSize: 11, fontFamily: 'monospace' },

  label: { fontSize: 12, color: '#737373', marginBottom: 6, fontFamily: 'monospace' },
  input: { borderWidth: 1, borderColor: '#262626', backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10, fontSize: 14, color: '#ffffff', marginBottom: 12, fontFamily: 'monospace' },
  responsiveGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  gridCol: { flex: 1, minWidth: 140, paddingHorizontal: 4 },

  resultCard: { backgroundColor: '#121212', padding: 16, borderRadius: 8, marginBottom: 24, borderWidth: 1, borderColor: '#262626' },
  resultTitle: { fontSize: 12, color: '#737373', marginBottom: 12, fontFamily: 'monospace' },
  profitBox: { backgroundColor: '#0a0a0a', padding: 16, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#1f1f1f' },
  profitTitle: { fontSize: 11, color: '#737373', fontFamily: 'monospace' },
  profitAmount: { fontSize: 22, fontWeight: 'bold', marginVertical: 8, fontFamily: 'monospace' },
  breakEvenText: { fontSize: 12, color: '#a3a3a3', fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#262626', marginVertical: 14 },
  
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  detailLabel: { fontSize: 11, color: '#737373', fontFamily: 'monospace', flex: 1 },
  detailVal: { fontSize: 11, fontWeight: '600', color: '#ffffff', fontFamily: 'monospace' },
  detailLabelBold: { fontSize: 12, color: '#a3a3a3', fontFamily: 'monospace', fontWeight: 'bold' },
  detailValBold: { fontSize: 12, fontWeight: 'bold', color: '#ffffff', fontFamily: 'monospace' },

  // 🎯 台股標準配色：賺用紅 (#ef4444)，虧用綠 (#22c55e)
  profitRed: { color: '#ef4444' },
  lossGreen: { color: '#22c55e' },

  rebateHintBox: { marginTop: 12, backgroundColor: '#0a0a0a', padding: 8, borderRadius: 4, borderWidth: 1, borderColor: '#262626' },
  rebateHintText: { color: '#f59e0b', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#121212', borderRadius: 8, padding: 20, width: '100%', maxWidth: 500, borderWidth: 1, borderColor: '#404040' },
  modalTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', marginBottom: 12, fontFamily: 'monospace' },
  sectionBox: { backgroundColor: '#0a0a0a', padding: 12, borderRadius: 6, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginBottom: 8, fontFamily: 'monospace' },
  formulaLabel: { fontSize: 11, fontWeight: 'bold', color: '#a3a3a3', marginTop: 6, fontFamily: 'monospace' },
  formulaCode: { fontSize: 11, color: '#e5e5e5', backgroundColor: '#171717', padding: 6, borderRadius: 4, marginTop: 2, fontFamily: 'monospace', lineHeight: 16 },
  modalBrokerRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#171717' },
  modalBrokerName: { fontSize: 12, color: '#ffffff', fontFamily: 'monospace' },
  modalBrokerDetail: { fontSize: 11, color: '#737373', marginTop: 1, fontFamily: 'monospace' },
  closeBtn: { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
});