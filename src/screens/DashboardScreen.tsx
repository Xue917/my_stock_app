// src/screens/DashboardScreen.tsx
import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity, 
  Modal, 
  Pressable, 
  TextInput, 
  Switch 
} from 'react-native';
import { HoldingItem, RealizedTrade } from '../types';
import { useAuth } from '../context/AuthContext';
import { BROKER_OPTIONS } from '../data/brokers';

export default function DashboardScreen({ route }: { route?: any }) {
  const { user, profile, signOut, updateGoalMilestone } = useAuth();
  const [tab, setTab] = useState<'holdings' | 'history'>('holdings');
  
  // Modals
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [sellModalVisible, setSellModalVisible] = useState(false);

  // 監聽頂部選單按鈕觸發設定
  useEffect(() => {
    if (route?.params?.openSettings) {
      setSettingsModalVisible(true);
    }
  }, [route?.params]);

  // 資產數據
  const [cash, setCash] = useState<number>(100000);
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [historyTrades, setHistoryTrades] = useState<RealizedTrade[]>([]);

  // 🔑 新增：當切換使用者（user.id 變更或登出）時，徹底清空當前記憶體中的舊資料，防止讀取到上一位的資料
  useEffect(() => {
    setHoldings([]);
    setHistoryTrades([]);
    setCash(100000);
  }, [user?.id]);

  // 里程碑目標表單暫存
  const [inputYears, setInputYears] = useState(profile?.targetYears?.toString() || '3');
  const [inputProfit, setInputProfit] = useState(profile?.targetProfit?.toString() || '100000');

  useEffect(() => {
    if (profile) {
      setInputYears(profile.targetYears.toString());
      setInputProfit(profile.targetProfit.toString());
    }
  }, [profile]);

  // 表單暫存
  const [selectedHolding, setSelectedHolding] = useState<HoldingItem | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formShares, setFormShares] = useState('');
  const [formAvgCost, setFormAvgCost] = useState('');
  const [formCurrentPrice, setFormCurrentPrice] = useState('');
  
  // 賣出表單暫存（新增日期與時間）
  const [sellPriceInput, setSellPriceInput] = useState('');
  const [sellSharesInput, setSellSharesInput] = useState('');
  const [sellDateInput, setSellDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [sellTimeInput, setSellTimeInput] = useState('09:30');
  const [isDayTradeSell, setIsDayTradeSell] = useState(false);
  const [timeErrorMsg, setTimeErrorMsg] = useState('');

  const currentBroker = BROKER_OPTIONS.find((b) => b.id === profile?.defaultBrokerId) || BROKER_OPTIONS[0];

  // 計算數值
  const totalStockValue = holdings.reduce((sum, item) => sum + item.shares * item.currentPrice, 0);
  const totalStockCost = holdings.reduce((sum, item) => sum + item.shares * item.avgCost, 0);
  const totalNetWorth = cash + totalStockValue;
  const unrealizedPL = totalStockValue - totalStockCost;
  const realizedPL = historyTrades.reduce((sum, item) => sum + item.netProfit, 0);

  // 獲利進度
  const totalProfitSum = unrealizedPL + realizedPL;
  const targetProfitGoal = profile?.targetProfit || 100000;
  const milestoneProgress = Math.min(Math.max((totalProfitSum / targetProfitGoal) * 100, 0), 100);

  // 1. 保存獲利目標
  const handleSaveGoal = () => {
    const y = parseInt(inputYears) || 1;
    const p = parseFloat(inputProfit) || 10000;
    updateGoalMilestone(y, p);
    setSettingsModalVisible(false);
  };

  // 2. 新增持股
  const handleAddHolding = () => {
    if (!formCode || !formName || !formShares || !formAvgCost) return;
    const newHolding: HoldingItem = {
      id: Date.now().toString(),
      code: formCode.trim(),
      name: formName.trim(),
      shares: parseInt(formShares) || 0,
      avgCost: parseFloat(formAvgCost) || 0,
      currentPrice: parseFloat(formCurrentPrice) || parseFloat(formAvgCost) || 0,
    };
    setHoldings([...holdings, newHolding]);
    resetForm();
    setAddModalVisible(false);
  };

  // 3. 編輯與刪除持股
  const handleOpenEdit = (item: HoldingItem) => {
    setSelectedHolding(item);
    setFormCode(item.code);
    setFormName(item.name);
    setFormShares(item.shares.toString());
    setFormAvgCost(item.avgCost.toString());
    setFormCurrentPrice(item.currentPrice.toString());
    setEditModalVisible(true);
  };

  const handleSaveEdit = () => {
    if (!selectedHolding) return;
    setHoldings(holdings.map(h => h.id === selectedHolding.id ? {
      ...h,
      shares: parseInt(formShares) || 0,
      avgCost: parseFloat(formAvgCost) || 0,
      currentPrice: parseFloat(formCurrentPrice) || 0,
    } : h));
    resetForm();
    setEditModalVisible(false);
  };

  const handleDeleteHolding = (id: string) => {
    setHoldings(holdings.filter(h => h.id !== id));
    setEditModalVisible(false);
  };

  // 4. 賣出部位與計算損益（含 09:00 - 13:30 時間驗證）
  const handleOpenSell = (item: HoldingItem) => {
    setSelectedHolding(item);
    setSellPriceInput(item.currentPrice.toString());
    setSellSharesInput(item.shares.toString());
    setSellDateInput(new Date().toISOString().split('T')[0]);
    setSellTimeInput('09:30');
    setTimeErrorMsg('');
    setSellModalVisible(true);
  };

  const handleConfirmSell = () => {
    if (!selectedHolding) return;
    setTimeErrorMsg('');

    // 交易時間校驗：只能在 09:00 至 13:30 之間
    const timeMatch = sellTimeInput.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      setTimeErrorMsg('❌ 時間格式錯誤，請輸入格式如 09:30');
      return;
    }
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const timeInMinutes = hours * 60 + minutes;

    const startTime = 9 * 60; // 09:00
    const endTime = 13 * 60 + 30; // 13:30

    if (timeInMinutes < startTime || timeInMinutes > endTime) {
      setTimeErrorMsg('❌ 賣出時間必須介於台股交易時間 09:00 - 13:30 之間！');
      return;
    }

    const sPrice = parseFloat(sellPriceInput) || 0;
    const sShares = parseInt(sellSharesInput) || 0;
    if (sPrice <= 0 || sShares <= 0 || sShares > selectedHolding.shares) return;

    const bPrice = selectedHolding.avgCost;
    const rawBuyFee = bPrice * sShares * 0.001425 * currentBroker.discount;
    const buyFee = Math.max(Math.floor(rawBuyFee), currentBroker.minFee);

    const rawSellFee = sPrice * sShares * 0.001425 * currentBroker.discount;
    const sellFee = Math.max(Math.floor(rawSellFee), currentBroker.minFee);

    const taxRate = isDayTradeSell ? 0.0015 : 0.003;
    const tax = Math.floor(sPrice * sShares * taxRate);

    const cost = bPrice * sShares + buyFee;
    const revenue = sPrice * sShares - sellFee - tax;
    const netProfit = Math.round(revenue - cost);

    const newTrade: RealizedTrade = {
      id: Date.now().toString(),
      code: selectedHolding.code,
      name: selectedHolding.name,
      sellDate: `${sellDateInput} ${sellTimeInput}`,
      shares: sShares,
      buyPrice: bPrice,
      sellPrice: sPrice,
      isDayTrade: isDayTradeSell,
      netProfit: netProfit,
    };

    setHistoryTrades([newTrade, ...historyTrades]);
    setCash(prev => prev + revenue);

    if (sShares === selectedHolding.shares) {
      setHoldings(holdings.filter(h => h.id !== selectedHolding.id));
    } else {
      setHoldings(holdings.map(h => h.id === selectedHolding.id ? {
        ...h,
        shares: h.shares - sShares
      } : h));
    }

    setSellModalVisible(false);
  };

  const resetForm = () => {
    setFormCode('');
    setFormName('');
    setFormShares('');
    setFormAvgCost('');
    setFormCurrentPrice('');
    setSelectedHolding(null);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentWrapper}>
      {/* 1. 【獲利目標里程碑】卡片 - 置頂且加大顯示 */}
      <View style={styles.highlightCard}>
        <View style={styles.headerRow}>
          <Text style={styles.highlightCardTitle}>🏆 【獲利目標里程碑】</Text>
          <TouchableOpacity onPress={() => setSettingsModalVisible(true)}>
            <Text style={styles.clickEditBtn}>⚙️ 點擊右上角 USER 修改目標</Text>
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

        {/* 進度條 */}
        <View style={styles.progressHeaderRow}>
          <Text style={styles.progressLabel}>累計淨利: ${totalProfitSum.toLocaleString()} 元</Text>
          <Text style={styles.progressLabel}>目標額: ${(profile?.targetProfit || 100000).toLocaleString()} 元</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${milestoneProgress}%` }]} />
        </View>
      </View>

      {/* 2. 【資產總覽】卡片 */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>【資產總覽】</Text>
          <TouchableOpacity style={styles.infoBtn} onPress={() => setInfoModalVisible(true)}>
            <Text style={styles.infoBtnText}>[?] 計算邏輯說明</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.totalNetWorth}>${totalNetWorth.toLocaleString()} 新台幣</Text>

        <View style={styles.wrapRow}>
          <Text style={styles.subText}>可用現金: ${cash.toLocaleString()}</Text>
          <Text style={styles.subText}>股票市值: ${totalStockValue.toLocaleString()}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.wrapRow}>
          <View style={styles.plBlock}>
            <Text style={styles.subTitle}>未實現損益</Text>
            <Text style={[styles.plText, unrealizedPL >= 0 ? styles.profit : styles.loss]}>
              {unrealizedPL >= 0 ? '+' : ''}${unrealizedPL.toLocaleString()}
            </Text>
          </View>
          <View style={styles.plBlock}>
            <Text style={styles.subTitle}>歷史已實現損益 (已結算淨額)</Text>
            <Text style={[styles.plText, realizedPL >= 0 ? styles.profit : styles.loss]}>
              {realizedPL >= 0 ? '+' : ''}${realizedPL.toLocaleString()}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. 功能選單與新增按鈕 */}
      <View style={styles.actionRow}>
        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'holdings' && styles.activeTab]} onPress={() => setTab('holdings')}>
            <Text style={[styles.tabText, tab === 'holdings' && styles.activeTabText]}>現有持股 ({holdings.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'history' && styles.activeTab]} onPress={() => setTab('history')}>
            <Text style={[styles.tabText, tab === 'history' && styles.activeTabText]}>結算紀錄 ({historyTrades.length})</Text>
          </TouchableOpacity>
        </View>

        {tab === 'holdings' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => { resetForm(); setAddModalVisible(true); }}>
            <Text style={styles.addBtnText}>+ 新增持股部位</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 4. 列表區 */}
      {tab === 'holdings' ? (
        holdings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>【尚無持股部位資料，點擊上方按鈕新增】</Text>
          </View>
        ) : (
          holdings.map((item) => {
            const pl = (item.currentPrice - item.avgCost) * item.shares;
            const roi = item.avgCost > 0 ? ((item.currentPrice - item.avgCost) / item.avgCost) * 100 : 0;
            return (
              <View key={item.id} style={styles.listItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stockCode}>{item.code} // {item.name}</Text>
                  <Text style={styles.detailText}>{item.shares} 股 | 買入均價 ${item.avgCost} \vert{} 現價 ${item.currentPrice}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginRight: 16 }}>
                  <Text style={styles.stockPrice}>${(item.shares * item.currentPrice).toLocaleString()}</Text>
                  <Text style={[styles.detailText, pl >= 0 ? styles.profit : styles.loss]}>
                    {pl >= 0 ? '+' : ''}${pl.toLocaleString()} ({roi.toFixed(2)}%)
                  </Text>
                </View>
                <View style={styles.itemActionGroup}>
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
        historyTrades.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>【尚無歷史結算紀錄】</Text>
          </View>
        ) : (
          historyTrades.map((item) => (
            <View key={item.id} style={styles.listItem}>
              <View>
                <Text style={styles.stockCode}>{item.code} // {item.name} {item.isDayTrade && '【現股當沖】'}</Text>
                <Text style={styles.detailText}>賣出時間: {item.sellDate} | {item.shares} 股</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.stockPrice, item.netProfit >= 0 ? styles.profit : styles.loss]}>
                  {item.netProfit >= 0 ? `賺 +$${item.netProfit.toLocaleString()}` : `賠 -$${Math.abs(item.netProfit).toLocaleString()}`}
                </Text>
                <Text style={styles.detailText}>買進 ${item.buyPrice} ➔ 賣出 ${item.sellPrice}</Text>
              </View>
            </View>
          ))
        )
      )}

      {/* 新增持股 Modal */}
      <Modal animationType="fade" transparent={true} visible={addModalVisible} onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 新增持股部位</Text>
            <Text style={styles.label}>股票代號</Text>
            <TextInput style={styles.input} value={formCode} onChangeText={setFormCode} placeholder="例如：2330" placeholderTextColor="#404040" />
            <Text style={styles.label}>股票名稱</Text>
            <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="例如：台積電" placeholderTextColor="#404040" />
            <Text style={styles.label}>買入股數</Text>
            <TextInput style={styles.input} value={formShares} onChangeText={setFormShares} keyboardType="numeric" placeholder="1000" placeholderTextColor="#404040" />
            <Text style={styles.label}>買入成本 (元)</Text>
            <TextInput style={styles.input} value={formAvgCost} onChangeText={setFormAvgCost} keyboardType="numeric" placeholder="880" placeholderTextColor="#404040" />
            <Text style={styles.label}>目前市價 (元)</Text>
            <TextInput style={styles.input} value={formCurrentPrice} onChangeText={setFormCurrentPrice} keyboardType="numeric" placeholder="950" placeholderTextColor="#404040" />

            <TouchableOpacity style={styles.confirmBtn} onPress={handleAddHolding}>
              <Text style={styles.confirmBtnText}>確認新增</Text>
            </TouchableOpacity>
            <Pressable style={styles.closeBtn} onPress={() => setAddModalVisible(false)}>
              <Text style={styles.closeBtnText}>[取消]</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 編輯持股 Modal */}
      <Modal animationType="fade" transparent={true} visible={editModalVisible} onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 編輯部位 - {formName} ({formCode})</Text>
            <Text style={styles.label}>持股股數</Text>
            <TextInput style={styles.input} value={formShares} onChangeText={setFormShares} keyboardType="numeric" />
            <Text style={styles.label}>買入成本 (元)</Text>
            <TextInput style={styles.input} value={formAvgCost} onChangeText={setFormAvgCost} keyboardType="numeric" />
            <Text style={styles.label}>最新市價 (元)</Text>
            <TextInput style={styles.input} value={formCurrentPrice} onChangeText={setFormCurrentPrice} keyboardType="numeric" />

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
        </View>
      </Modal>

      {/* 賣出結算 Modal (新增日期、時間、09:00-13:30驗證) */}
      <Modal animationType="fade" transparent={true} visible={sellModalVisible} onRequestClose={() => setSellModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 賣出部位與損益結算 - {selectedHolding?.name}</Text>
            
            <Text style={styles.label}>賣出價格 (元)</Text>
            <TextInput style={styles.input} value={sellPriceInput} onChangeText={setSellPriceInput} keyboardType="numeric" />
            
            <Text style={styles.label}>賣出股數 (最大: {selectedHolding?.shares} 股)</Text>
            <TextInput style={styles.input} value={sellSharesInput} onChangeText={setSellSharesInput} keyboardType="numeric" />

            <View style={styles.responsiveGrid}>
              <View style={styles.gridCol}>
                <Text style={styles.label}>賣出日期 (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={sellDateInput} onChangeText={setSellDateInput} placeholder="YYYY-MM-DD" placeholderTextColor="#404040" />
              </View>
              <View style={styles.gridCol}>
                <Text style={styles.label}>賣出時間 (09:00-13:30)</Text>
                <TextInput style={styles.input} value={sellTimeInput} onChangeText={setSellTimeInput} placeholder="09:30" placeholderTextColor="#404040" />
              </View>
            </View>

            {timeErrorMsg ? <Text style={styles.errorText}>{timeErrorMsg}</Text> : null}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>現股當沖 (證交稅 0.15%)</Text>
              <Switch value={isDayTradeSell} onValueChange={setIsDayTradeSell} trackColor={{ false: '#262626', true: '#404040' }} thumbColor="#ffffff" />
            </View>

            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmSell}>
              <Text style={styles.confirmBtnText}>確認賣出並計算損益歸檔</Text>
            </TouchableOpacity>
            <Pressable style={styles.closeBtn} onPress={() => setSellModalVisible(false)}>
              <Text style={styles.closeBtnText}>[取消]</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 計算邏輯 Modal */}
      <Modal animationType="fade" transparent={true} visible={infoModalVisible} onRequestClose={() => setInfoModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 總資產與回報率計算公式</Text>
            <View style={styles.formulaSection}>
              <Text style={styles.formulaLabel}>1. 淨資產總額：</Text>
              <Text style={styles.formulaCode}>淨資產 = 可用現金 + 所有持股市值總和</Text>

              <Text style={styles.formulaLabel}>2. 未實現損益：</Text>
              <Text style={styles.formulaCode}>未實現損益 = (當前股價 - 成本均價) × 持有股數</Text>

              <Text style={styles.formulaLabel}>3. 已實現損益 (賣出結算)：</Text>
              <Text style={styles.formulaCode}>已實現損益 = (賣出總額 - 賣出手續費 - 證交稅) - (買入總成本 + 買進手續費)</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={() => setInfoModalVisible(false)}>
              <Text style={styles.closeBtnText}>[關閉視窗]</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 設定與目標修改 Modal */}
      <Modal animationType="fade" transparent={true} visible={settingsModalVisible} onRequestClose={() => setSettingsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>// 使用者 (USER) 設定與獲利目標控制台</Text>
            
            <View style={styles.settingItem}>
              <Text style={styles.settingLabel}>帳號電子郵件：</Text>
              <Text style={styles.settingValue}>{user?.email || '訪客模式'}</Text>
            </View>

            <View style={styles.settingItem}>
              <Text style={styles.settingLabel}>🎯 設定賺錢目標年限 (年)</Text>
              <TextInput style={styles.input} value={inputYears} onChangeText={setInputYears} keyboardType="numeric" placeholder="例如: 3" placeholderTextColor="#404040" />

              <Text style={styles.settingLabel}>🎯 設定目標賺取總金額 (元)</Text>
              <TextInput style={styles.input} value={inputProfit} onChangeText={setInputProfit} keyboardType="numeric" placeholder="例如: 100000" placeholderTextColor="#404040" />

              <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveGoal}>
                <Text style={styles.confirmBtnText}>儲存獲利目標設定</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.logoutBtn} onPress={() => { setSettingsModalVisible(false); signOut(); }}>
              <Text style={styles.logoutBtnText}>[登出系統]</Text>
            </TouchableOpacity>
            <Pressable style={styles.closeBtn} onPress={() => setSettingsModalVisible(false)}>
              <Text style={styles.closeBtnText}>[關閉設定]</Text>
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
  infoBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  infoBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  totalNetWorth: { color: '#ffffff', fontSize: 32, fontWeight: '700', marginVertical: 12, fontFamily: 'monospace' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 4, gap: 12 },
  plBlock: { minWidth: 150 },
  subText: { color: '#a3a3a3', fontSize: 13, fontFamily: 'monospace' },
  subTitle: { color: '#737373', fontSize: 11, fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#262626', marginVertical: 12 },
  plText: { fontSize: 16, fontWeight: 'bold', marginTop: 4, fontFamily: 'monospace' },
  profit: { color: '#ffffff' },
  loss: { color: '#737373' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 },
  tabContainer: { flexDirection: 'row', backgroundColor: '#121212', borderRadius: 6, padding: 4, borderWidth: 1, borderColor: '#262626' },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', borderRadius: 4 },
  activeTab: { backgroundColor: '#262626' },
  tabText: { fontSize: 12, color: '#737373', fontWeight: '600' },
  activeTabText: { color: '#ffffff' },
  addBtn: { backgroundColor: '#262626', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  addBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  emptyBox: { padding: 48, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: '#262626', borderRadius: 8 },
  emptyText: { color: '#525252', fontFamily: 'monospace', fontSize: 13 },
  listItem: { backgroundColor: '#121212', padding: 16, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderWidth: 1, borderColor: '#1f1f1f' },
  stockCode: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', fontFamily: 'monospace' },
  stockPrice: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', fontFamily: 'monospace' },
  detailText: { fontSize: 11, color: '#737373', marginTop: 4, fontFamily: 'monospace' },
  itemActionGroup: { flexDirection: 'row', gap: 8 },
  sellBtn: { backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: '#404040' },
  sellBtnText: { color: '#ffffff', fontSize: 11, fontFamily: 'monospace' },
  editBtn: { backgroundColor: '#262626', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4 },
  editBtnText: { color: '#a3a3a3', fontSize: 11, fontFamily: 'monospace' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#121212', borderRadius: 8, padding: 20, width: '100%', maxWidth: 500, borderWidth: 1, borderColor: '#404040' },
  modalTitle: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', marginBottom: 16, fontFamily: 'monospace' },
  label: { fontSize: 12, color: '#a3a3a3', marginBottom: 4, fontFamily: 'monospace' },
  input: { borderWidth: 1, borderColor: '#262626', backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10, fontSize: 14, color: '#ffffff', marginBottom: 12, fontFamily: 'monospace' },
  responsiveGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  gridCol: { flex: 1, minWidth: 140, paddingHorizontal: 4 },
  errorText: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace', marginBottom: 8 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 12 },
  switchLabel: { fontSize: 12, color: '#a3a3a3', fontFamily: 'monospace' },
  confirmBtn: { backgroundColor: '#262626', paddingVertical: 12, borderRadius: 4, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#525252' },
  confirmBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold', fontFamily: 'monospace' },
  deleteBtn: { backgroundColor: '#7f1d1d', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  deleteBtnText: { color: '#fca5a5', fontSize: 12, fontFamily: 'monospace' },
  formulaSection: { backgroundColor: '#0a0a0a', padding: 12, borderRadius: 6, marginBottom: 16, borderWidth: 1, borderColor: '#262626' },
  formulaLabel: { fontSize: 12, fontWeight: 'bold', color: '#a3a3a3', marginTop: 8 },
  formulaCode: { fontSize: 11, color: '#e5e5e5', backgroundColor: '#171717', padding: 8, borderRadius: 4, marginTop: 4, fontFamily: 'monospace' },
  settingItem: { marginVertical: 8, padding: 12, backgroundColor: '#0a0a0a', borderRadius: 6, borderWidth: 1, borderColor: '#262626' },
  settingLabel: { color: '#737373', fontSize: 11, fontFamily: 'monospace' },
  settingValue: { color: '#ffffff', fontSize: 13, fontWeight: 'bold', marginTop: 4, fontFamily: 'monospace' },
  logoutBtn: { backgroundColor: '#7f1d1d', paddingVertical: 12, borderRadius: 4, alignItems: 'center', marginVertical: 12, borderWidth: 1, borderColor: '#991b1b' },
  logoutBtnText: { color: '#fca5a5', fontWeight: 'bold', fontSize: 12, fontFamily: 'monospace' },
  closeBtn: { backgroundColor: '#1a1a1a', paddingVertical: 10, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#737373', fontSize: 12, fontFamily: 'monospace' },
});