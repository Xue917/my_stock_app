// src/screens/SubscriptionScreen.tsx
import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity, Modal, Pressable } from 'react-native';

export default function SubscriptionScreen() {
  const [stockName, setStockName] = useState('');
  const [price, setPrice] = useState('');
  const [marketPrice, setMarketPrice] = useState('');
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const subPrice = parseFloat(price) || 0;
  const mktPrice = parseFloat(marketPrice) || 0;
  
  const totalCost = subPrice > 0 ? subPrice * 1000 + 20 + 50 : 0;
  const expectedProfit = (subPrice > 0 && mktPrice > 0) ? (mktPrice - subPrice) * 1000 - 70 : 0;
  const roi = totalCost > 0 ? (expectedProfit / totalCost) * 100 : 0;
  const premiumRate = subPrice > 0 ? ((mktPrice - subPrice) / subPrice) * 100 : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentWrapper}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>【參數設定】</Text>
          <TouchableOpacity style={styles.infoBtn} onPress={() => setInfoModalVisible(true)}>
            <Text style={styles.infoBtnText}>[?] 計算公式與邏輯</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>股票代號 / 名稱</Text>
        <TextInput 
          style={styles.input} 
          value={stockName} 
          onChangeText={setStockName} 
          placeholder="例如：2330 台積電" 
          placeholderTextColor="#404040" 
        />

        <View style={styles.responsiveGrid}>
          <View style={styles.gridCol}>
            <Text style={styles.label}>承銷價 (扣款價)</Text>
            <TextInput 
              style={styles.input} 
              value={price} 
              onChangeText={setPrice} 
              keyboardType="numeric" 
              placeholder="0.00" 
              placeholderTextColor="#404040" 
            />
          </View>
          <View style={styles.gridCol}>
            <Text style={styles.label}>目前市價</Text>
            <TextInput 
              style={styles.input} 
              value={marketPrice} 
              onChangeText={setMarketPrice} 
              keyboardType="numeric" 
              placeholder="0.00" 
              placeholderTextColor="#404040" 
            />
          </View>
        </View>
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>【套利效益分析】</Text>
        
        <View style={styles.profitBox}>
          <Text style={styles.profitTitle}>中籤預估套利淨額</Text>
          <Text style={[styles.profitAmount, expectedProfit >= 0 ? styles.profit : styles.loss]}>
            {expectedProfit >= 0 ? '+' : ''}${expectedProfit.toLocaleString()} 新台幣
          </Text>
          <Text style={styles.subDetail}>溢價率: +{premiumRate.toFixed(2)}% | 預期報酬率: {roi.toFixed(2)}%</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>預扣款總額 (承銷價×1000 + 處理費$20 + 劃撥費$50)</Text>
          <Text style={styles.detailVal}>${totalCost.toLocaleString()} 元</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>未中籤沒收規費 (處理費)</Text>
          <Text style={styles.detailVal}>$20 元</Text>
        </View>
      </View>

      {/* 公式 Modal */}
      <Modal animationType="fade" transparent={true} visible={infoModalVisible} onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 股票申購套利計算模型</Text>
            <View style={styles.formulaSection}>
              <Text style={styles.formulaLabel}>1. 預扣款總額：</Text>
              <Text style={styles.formulaCode}>預扣金額 = (承銷價 × 1000股) + 處理費 ($20) + 工本劃撥費 ($50)</Text>

              <Text style={styles.formulaLabel}>2. 中籤預期淨損益：</Text>
              <Text style={styles.formulaCode}>預期淨損益 = (當前市價 - 承銷價) × 1000股 - 規費總計 ($70)</Text>

              <Text style={styles.formulaLabel}>3. 市場溢價率：</Text>
              <Text style={styles.formulaCode}>溢價率 (%) = [(當前市價 - 承銷價) ÷ 承銷價] × 100%</Text>
            </View>
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
  card: { backgroundColor: '#121212', borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#262626' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 12, color: '#737373', fontFamily: 'monospace' },
  infoBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  infoBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  label: { fontSize: 12, color: '#a3a3a3', marginBottom: 6, fontFamily: 'monospace' },
  input: { borderWidth: 1, borderColor: '#262626', backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10, fontSize: 14, color: '#ffffff', marginBottom: 12, fontFamily: 'monospace' },
  responsiveGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  gridCol: { flex: 1, minWidth: 140, paddingHorizontal: 4 },
  resultCard: { backgroundColor: '#121212', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#262626' },
  resultTitle: { fontSize: 12, color: '#737373', marginBottom: 12, fontFamily: 'monospace' },
  profitBox: { backgroundColor: '#0a0a0a', padding: 16, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#1f1f1f' },
  profitTitle: { fontSize: 11, color: '#737373', fontFamily: 'monospace' },
  profitAmount: { fontSize: 22, fontWeight: 'bold', marginVertical: 8, fontFamily: 'monospace' },
  subDetail: { fontSize: 11, color: '#a3a3a3', fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#262626', marginVertical: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  detailLabel: { fontSize: 11, color: '#737373', fontFamily: 'monospace', flex: 1 },
  detailVal: { fontSize: 11, fontWeight: '600', color: '#ffffff', fontFamily: 'monospace' },
  profit: { color: '#ffffff' },
  loss: { color: '#737373' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#121212', borderRadius: 8, padding: 20, width: '100%', maxWidth: 500, borderWidth: 1, borderColor: '#404040' },
  modalTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', marginBottom: 16, fontFamily: 'monospace' },
  formulaSection: { backgroundColor: '#0a0a0a', padding: 12, borderRadius: 6, marginBottom: 16, borderWidth: 1, borderColor: '#262626' },
  formulaLabel: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginTop: 8 },
  formulaCode: { fontSize: 11, color: '#e5e5e5', backgroundColor: '#171717', padding: 8, borderRadius: 4, marginTop: 4, fontFamily: 'monospace' },
  closeBtn: { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
});