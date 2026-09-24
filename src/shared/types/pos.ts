export type EmployeeRole = "cashier" | "manager" | "administrator"
export type OrderType = "dine-in" | "takeaway" | "delivery"
export type PaymentMethod = "card" | "cash" | "qr"
export type KitchenStatus = "queued" | "preparing" | "ready" | "completed"

export type PosEmployee = { id: string; code: string; displayName: string; role: EmployeeRole }
export type PosTerminal = { id: string; externalId: string; name: string; terminalNumber: number }
export type PosRestaurant = { id: string; externalId: string; name: string; city: string }

export type PosAccessSession = {
  sessionToken: string
  expiresAt: number
  employee: PosEmployee
  terminal: PosTerminal
  restaurant: PosRestaurant
}

export type DraftLine = {
  clientLineId: string
  productId: string
  name: string
  nameKk: string
  unitPrice: number
  quantity: number
  modifiers: string[]
}
