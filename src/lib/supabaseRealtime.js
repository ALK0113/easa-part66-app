import { supabase } from './supabase.js'

export function subscribeToTables(tables, onChange, channelName) {
  let refreshTimer
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(onChange, 120)
  }
  let channel = supabase.channel(`${channelName}-${Math.random().toString(36).slice(2)}`)
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh)
  }
  channel.subscribe()
  return () => {
    clearTimeout(refreshTimer)
    void supabase.removeChannel(channel)
  }
}