// src/screens/FeeCalculatorScreen.tsx
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, ScrollView, Switch, TouchableOpacity, Modal, Pressable } from 'react-native';
import { BROKER_OPTIONS } from '../data/brokers';
import { BrokerConfig } from '../types';
import { useAuth } from '../context/AuthContext';

export default function FeeCalculatorScreen() {
  const { profile, updateDefaultBroker } = useAuth();
  
  const [selectedBroker, setSelectedBroker] = useState<BrokerConfig>(BROKER_OPTIONS[0]);
  const [isDayTrade, setIsDayTrade] = useState(true);
  
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [shares, setShares] = useState('');

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

  const rawBuyFee = bPrice * numShares * 0.001425 * selectedBroker.discount;
  const buyFee = (bPrice > 0 && numShares > 0) ? Math.max(Math.floor(rawBuyFee), selectedBroker.minFee) : 0;

  const rawSellFee = sPrice * numShares * 0.001425 * selectedBroker.discount;
  const sellFee = (sPrice > 0 && numShares > 0) ? Math.max(Math.floor(rawSellFee), selectedBroker.minFee) : 0;

  const taxRate = isDayTrade ? 0.0015 : 0.003;
  const tax = Math.floor(sPrice * numShares * taxRate);

  const totalCost = bPrice * numShares + buyFee;
  const totalRevenue = sPrice * numShares - sellFee - tax;
  const netProfit = (bPrice > 0 && sPrice > 0 && numShares > 0) ? totalRevenue - totalCost : 0;
  const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  const breakEvenPrice = (bPrice > 0 && numShares > 0)
    ? (bPrice * numShares + buyFee) / (numShares * (1 - 0.001425 * selectedBroker.discount - taxRate))
    : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentWrapper}>
      <View style={styles.brokerBar}>
        <View style={styles.brokerHeaderRow}>
          <Text style={styles.brokerLabel}>【選擇券商戶頭】</Text>
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
                {broker.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>交易模式: {isDayTrade ? '現股當沖 (證交稅 0.15%)' : '一般留倉 (證交稅 0.30%)'}</Text>
          <Switch value={isDayTrade} onValueChange={setIsDayTrade} trackColor={{ false: '#262626', true: '#404040' }} thumbColor="#ffffff" />
        </View>

        <View style={styles.responsiveGrid}>
          <View style={styles.gridCol}>
            <Text style={styles.label}>買入價格 (元)</Text>
            <TextInput style={styles.input} value={buyPrice} onChangeText={setBuyPrice} keyboardType="numeric" placeholder="0.00" placeholderTextColor="#404040" />
          </View>
          <View style={styles.gridCol}>
            <Text style={styles.label}>預計賣價 (元)</Text>
            <TextInput style={styles.input} value={sellPrice} onChangeText={setSellPrice} keyboardType="numeric" placeholder="0.00" placeholderTextColor="#404040" />
          </View>
        </View>

        <Text style={styles.label}>交易股數 (1張 = 1000股)</Text>
        <TextInput style={styles.input} value={shares} onChangeText={setShares} keyboardType="numeric" placeholder="0" placeholderTextColor="#404040" />
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>【交易費用明細】</Text>

        <View style={styles.profitBox}>
          <Text style={styles.profitTitle}>預估淨損益</Text>
          <Text style={[styles.profitAmount, netProfit >= 0 ? styles.profit : styles.loss]}>
            {netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} 新台幣 ({roi.toFixed(2)}%)
          </Text>
          <Text style={styles.breakEvenText}>
            保本兩平賣出價: <Text style={{ fontWeight: 'bold', color: '#ffffff' }}>${breakEvenPrice.toFixed(2)} 元</Text>
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>買進手續費 ({(selectedBroker.discount * 10).toFixed(1)}折 / 低消 ${selectedBroker.minFee} 元)</Text>
          <Text style={styles.detailVal}>${buyFee} 元</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>賣出手續費</Text>
          <Text style={styles.detailVal}>${sellFee} 元</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>證券交易稅 ({(taxRate * 100).toFixed(2)}%)</Text>
          <Text style={styles.detailVal}>${tax} 元</Text>
        </View>
      </View>

      {/* 公式 Modal */}
      <Modal animationType="fade" transparent={true} visible={infoModalVisible} onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 交易規費與兩平演算架構</Text>
            <ScrollView style={{ maxHeight: 400, marginVertical: 10 }}>
              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>【規費計算演算法】</Text>
                <Text style={styles.formulaLabel}>1. 買/賣手續費：</Text>
                <Text style={styles.formulaCode}>手續費 = 取較大值 [ 無條件捨去 (股價 × 股數 × 0.1425% × 券商折數) , 最低消費金額 ]</Text>

                <Text style={styles.formulaLabel}>2. 證券交易稅：</Text>
                <Text style={styles.formulaCode}>證交稅 = 無條件捨去 (賣出價 × 股數 × 稅率) [現股當沖 0.15% / 一般留倉 0.3%]</Text>

                <Text style={styles.formulaLabel}>3. 保本兩平賣出價：</Text>
                <Text style={styles.formulaCode}>兩平價 = (買入總額 + 買進手續費) ÷ [ 股數 × (1 - 0.1425% × 券商折數 - 證交稅率) ]</Text>
              </View>

              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>【各大券商折數對照表】</Text>
                {BROKER_OPTIONS.map((b) => (
                  <View key={b.id} style={styles.modalBrokerRow}>
                    <Text style={styles.modalBrokerName}>{b.name}</Text>
                    <Text style={styles.modalBrokerDetail}>手續費折扣：{(b.discount * 10).toFixed(1)}折 | 最低消費：${b.minFee} 元</Text>
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
  activeBrokerChip: { backgroundColor: '#262626', borderColor: '#525252' },
  chipText: { fontSize: 11, color: '#737373', fontFamily: 'monospace' },
  activeChipText: { color: '#ffffff', fontWeight: 'bold' },
  card: { backgroundColor: '#121212', padding: 16, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  switchLabel: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', fontFamily: 'monospace' },
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
  divider: { height: 1, backgroundColor: '#262626', marginVertical: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  detailLabel: { fontSize: 11, color: '#737373', fontFamily: 'monospace', flex: 1 },
  detailVal: { fontSize: 11, fontWeight: '600', color: '#ffffff', fontFamily: 'monospace' },
  profit: { color: '#ffffff' },
  loss: { color: '#737373' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#121212', borderRadius: 8, padding: 20, width: '100%', maxWidth: 500, borderWidth: 1, borderColor: '#404040' },
  modalTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', marginBottom: 12, fontFamily: 'monospace' },
  sectionBox: { backgroundColor: '#0a0a0a', padding: 12, borderRadius: 6, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginBottom: 8, fontFamily: 'monospace' },
  formulaLabel: { fontSize: 11, fontWeight: 'bold', color: '#a3a3a3', marginTop: 6, fontFamily: 'monospace' },
  formulaCode: { fontSize: 11, color: '#e5e5e5', backgroundColor: '#171717', padding: 6, borderRadius: 4, marginTop: 2, fontFamily: 'monospace' },
  modalBrokerRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#171717' },
  modalBrokerName: { fontSize: 12, color: '#ffffff', fontFamily: 'monospace' },
  modalBrokerDetail: { fontSize: 11, color: '#737373', marginTop: 1, fontFamily: 'monospace' },
  closeBtn: { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
});