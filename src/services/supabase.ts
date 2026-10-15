// src/services/supabase.ts
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://rnbyydgamjomsyzfpwzf.supabase.co';

// 填入傳統標準的 anon JWT Key
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuYnl5ZGdhbWpvbXN5emZwd3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjEyNzgsImV4cCI6MjEwMjk5NzI3OH0._VvEYMLEjv_7SS4Loo6eTxKC9f8CH7gCWnUEBsHw2FI';

// Web 端使用 window.localStorage，App 端使用 AsyncStorage
const customStorage = Platform.OS === 'web'
  ? (typeof window !== 'undefined' ? window.localStorage : undefined)
  : AsyncStorage;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: customStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});