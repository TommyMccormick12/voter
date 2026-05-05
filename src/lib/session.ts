import { supabase } from './supabase';

const SESSION_KEY = 'voter_session_token';

let cachedSessionId: string | null = null;

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getOrCreateSession(): Promise<string> {
  if (typeof window === 'undefined') return '';

  let token = localStorage.getItem(SESSION_KEY);

  if (!token) {
    token = generateToken();
    localStorage.setItem(SESSION_KEY, token);

    const { data, error } = await supabase
      .from('sessions')
      .insert({ session_token: token })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create session:', error.message);
    } else if (data) {
      cachedSessionId = data.id;
    }
  } else {
    const { data, error } = await supabase
      .from('sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('session_token', token)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to update session:', error.message);
    } else if (data) {
      cachedSessionId = data.id;
    }
  }

  return token;
}

export async function getSessionId(): Promise<string | null> {
  if (cachedSessionId) return cachedSessionId;

  const token = getSessionToken();
  if (!token) return null;

  const { data, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('session_token', token)
    .single();

  if (error) {
    console.error('Failed to look up session:', error.message);
    return null;
  }

  cachedSessionId = data.id;
  return cachedSessionId;
}

export async function setSessionLocation(token: string, zipCode: string) {
  const { error } = await supabase
    .from('sessions')
    .update({ zip_code: zipCode })
    .eq('session_token', token);

  if (error) {
    console.error('Failed to set session location:', error.message);
  }
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_KEY);
}
