import { notConnectedAdapter } from "./types"

// Outgoing calls through the cloud PBX (B-INT-1: provider not chosen). configured() is false, so
// createCall answers «Провайдер телефонии не настроен» at once; a queued call job ends in dead-letter.
// Incoming calls do not need this adapter — they arrive through the signed webhook (domains/telephony).
export const TELEPHONY_PROVIDER = "telephony"
export const telephonyAdapter = notConnectedAdapter(TELEPHONY_PROVIDER, null, "телефония (облачная АТС)")
