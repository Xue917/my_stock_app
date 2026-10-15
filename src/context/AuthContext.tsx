// src/context/AuthContext.tsx
import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

interface UserProfile {
  id: string;
  defaultBrokerId: string;
  targetYears: number;
  targetProfit: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  signUp: (email: string, pass: string) => Promise<{ error: any }>;
  signIn: (email: string, pass: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updateDefaultBroker: (brokerId: string) => Promise<void>;
  updateGoalMilestone: (years: number, profit: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserProfile(session.user.id);
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (userId: string) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (data) {
        setProfile({
          id: data.id,
          defaultBrokerId: data.default_broker_id || 'cathay',
          targetYears: data.target_years || 3,
          targetProfit: data.target_profit || 100000,
        });
      }
    } catch (err) {
      console.log('無 Profile 資料');
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password: pass });
    if (data.user && !error) {
      await supabase.from('profiles').insert([{ id: data.user.id, default_broker_id: 'cathay', target_years: 3, target_profit: 100000 }]);
    }
    return { error };
  };

  const signIn = async (email: string, pass: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const updateDefaultBroker = async (brokerId: string) => {
    setProfile((prev) => (prev ? { ...prev, defaultBrokerId: brokerId } : null));
    if (!user) return;
    await supabase.from('profiles').upsert({ id: user.id, default_broker_id: brokerId });
  };

  const updateGoalMilestone = async (years: number, profit: number) => {
    setProfile((prev) => (prev ? { ...prev, targetYears: years, targetProfit: profit } : null));
    if (!user) return;
    await supabase.from('profiles').upsert({ id: user.id, target_years: years, target_profit: profit });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        signUp,
        signIn,
        signOut,
        updateDefaultBroker,
        updateGoalMilestone,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必須在 AuthProvider 內部使用');
  }
  return context;
};