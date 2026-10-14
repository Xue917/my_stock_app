// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    if (!email || !password) {
      setErrorMsg('請填寫完整帳號與密碼');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) setErrorMsg(`登入失敗：${error.message}`);
    } else {
      const { error } = await signUp(email, password);
      if (error) setErrorMsg(`註冊失敗：${error.message}`);
      else setErrorMsg('註冊成功！請直接點擊登入');
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.authCard}>
        <Text style={styles.title}>📈 股票與資產管理系統</Text>
        <Text style={styles.subTitle}>// {isLogin ? '使用者登入' : '建立新帳號'}</Text>

        <Text style={styles.label}>電子郵件 (Email)</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="your@email.com"
          placeholderTextColor="#404040"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>密碼 (Password)</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#404040"
          secureTextEntry
        />

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitBtnText}>{isLogin ? '立即登入' : '註冊帳號'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchBtn} onPress={() => { setIsLogin(!isLogin); setErrorMsg(''); }}>
          <Text style={styles.switchBtnText}>
            {isLogin ? '還沒有帳號？點此註冊' : '已有帳號？點此登入'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 16 },
  authCard: { backgroundColor: '#121212', borderRadius: 8, padding: 24, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: '#262626' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#ffffff', textAlign: 'center', fontFamily: 'monospace' },
  subTitle: { fontSize: 13, color: '#737373', textAlign: 'center', marginTop: 6, marginBottom: 20, fontFamily: 'monospace' },
  label: { fontSize: 12, color: '#a3a3a3', marginBottom: 6, fontFamily: 'monospace' },
  input: { borderWidth: 1, borderColor: '#262626', backgroundColor: '#0a0a0a', borderRadius: 6, padding: 12, fontSize: 14, color: '#ffffff', marginBottom: 16, fontFamily: 'monospace' },
  errorText: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 },
  submitBtn: { backgroundColor: '#262626', paddingVertical: 14, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#525252', marginTop: 8 },
  submitBtnText: { color: '#ffffff', fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace' },
  switchBtn: { marginTop: 16, alignItems: 'center' },
  switchBtnText: { color: '#a3a3a3', fontSize: 12, textDecorationLine: 'underline', fontFamily: 'monospace' },
});