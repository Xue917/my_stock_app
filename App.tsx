// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TouchableOpacity, Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';

import AuthScreen from './src/screens/AuthScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import FeeCalculatorScreen from './src/screens/FeeCalculatorScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function GlobalHeaderRight({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  return (
    <TouchableOpacity 
      style={styles.globalAvatarBtn} 
      onPress={() => navigation.navigate('Dashboard', { openSettings: true })}
    >
      <Text style={styles.globalAvatarText}>
        👤 {user?.email ? user.email.split('@')[0].toUpperCase() : '使用者 (USER)'}
      </Text>
    </TouchableOpacity>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      id="MainTabs"
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#262626', height: 60 },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold' },
        tabBarActiveTintColor: '#ffffff',
        tabBarInactiveTintColor: '#737373',
        tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#262626', height: 55 },
        tabBarLabelStyle: { fontSize: 12, fontFamily: 'monospace', paddingBottom: 4 },
        headerRight: () => <GlobalHeaderRight navigation={navigation} />,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: '📊 總資產管理' }} />
      <Tab.Screen name="FeeCalculator" component={FeeCalculatorScreen} options={{ title: '🧮 手續費與當沖' }} />
      <Tab.Screen name="Subscription" component={SubscriptionScreen} options={{ title: '🎰 申購計算器' }} />
      
    </Tab.Navigator>
  );
}

function NavigationRoot() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return (
    <Stack.Navigator id="RootStack" screenOptions={{ headerShown: false }}>
      {!session ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <Stack.Screen name="Main" component={MainTabs} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <NavigationRoot />
      </NavigationContainer>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  globalAvatarBtn: {
    marginRight: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: '#525252',
  },
  globalAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
});